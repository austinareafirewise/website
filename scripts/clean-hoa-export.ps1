<#
.SYNOPSIS
    Cleans the board's HOA spreadsheet export into a file the Firewise groups
    import will accept.

.DESCRIPTION
    The Alliance keeps its HOA contact list in a spreadsheet. Saved out, that
    file needs the same handful of corrections every time — line breaks inside
    cells, a role packed into the contact's name, an email that has wandered
    into the phone column. This applies them, and names anything it cannot
    decide in a FLAGS column rather than guessing.

    Run it, read the FLAGS column, fix what it asks about in the source
    spreadsheet, and run it again. Then import the result at
    /admin/ -> Firewise groups -> Import from a file.

    Import-Csv is used rather than reading lines, because the export has
    quoted fields containing tabs and newlines that a line reader would split
    into phantom rows.

.PARAMETER Source
    The spreadsheet export. Tab-separated by default; pass -Delimiter ","
    for a CSV.

.PARAMETER Out
    Where to write the cleaned file. Defaults to the source name with
    " - cleaned" before the extension.

.PARAMETER Status
    The status every group is given. One of prospective, in-progress,
    recognized, lapsed, inactive — or a word of your own, which the importer
    will report and turn into Prospective.

.EXAMPLE
    .\scripts\clean-hoa-export.ps1 -Source "$env:USERPROFILE\Downloads\Temp HOAs.txt"

.NOTES
    The cleaned file holds names, phone numbers and email addresses. Keep it
    out of the repository — see .gitignore.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [string]$Out,

    [string]$Delimiter = "`t",

    [string]$Status = "Recognized"
)

$ErrorActionPreference = "Stop"

if (-not $Out) {
    $dir  = Split-Path -Parent $Source
    $base = [System.IO.Path]::GetFileNameWithoutExtension($Source)
    $ext  = [System.IO.Path]::GetExtension($Source)
    $Out  = Join-Path $dir "$base - cleaned$ext"
}

# ----------------------------------------------------------------------------
# Board decisions. Edit these rather than the logic below.
# ----------------------------------------------------------------------------

# Counts the board supplied that the export did not carry, or that the export
# recorded as something other than a number.
$HOUSEHOLD_OVERRIDES = @{
    "Meadow Mountain POA" = "41"
}

# Groups left out, with the reason. A skipped group takes its continuation
# rows with it, since those rows carry no name of their own and would
# otherwise attach to whichever group came next.
$SKIP_GROUPS = @{
    "Meadow Mountain POA" = "already on the site as 'Meadow Mountain Firewise Community'"
}

# ----------------------------------------------------------------------------

$rows = Import-Csv -LiteralPath $Source -Delimiter $Delimiter
$emailRe = '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$'

$log = New-Object System.Collections.ArrayList
function Note($what) { [void]$log.Add($what) }

# Collapse an embedded line break, squeeze runs of whitespace, trim.
function Clean([string]$v) {
    if ($null -eq $v) { return "" }
    ($v -replace "`r?`n", " ") -replace '\s+', ' ' | ForEach-Object { $_.Trim() }
}

function AppendNote($row, $text) {
    $row.Notes = (@($row.Notes, $text) | Where-Object { $_ }) -join "; "
}

$outRows = New-Object System.Collections.ArrayList
$currentGroup = ""
$currentGroupRow = $null
$skipping = $false

foreach ($r in $rows) {
    $name  = Clean $r.Name
    $hh    = Clean $r.'# Households'
    $city  = Clean $r.City
    $zip   = Clean $r.'ZIP Code'
    $con   = Clean $r.Contact
    $ph    = Clean $r.Phone
    $em    = Clean $r.Email
    $notes = Clean $r.NOTES

    if (-not ($name + $hh + $city + $zip + $con + $ph + $em + $notes)) { continue }

    $flags = New-Object System.Collections.ArrayList
    $area  = ""
    if ($name) { $currentGroup = $name }
    $g = $currentGroup

    if ($name) { $skipping = $SKIP_GROUPS.ContainsKey($name) }
    if ($skipping) {
        if ($name) { Note "$g : left out - $($SKIP_GROUPS[$name])" }
        continue
    }

    # ---- Households --------------------------------------------------------
    if ($name -and $HOUSEHOLD_OVERRIDES.ContainsKey($name)) {
        $was = $hh
        $hh = $HOUSEHOLD_OVERRIDES[$name]
        Note "$g : households '$was' replaced with $hh (supplied by the board)"
    }
    elseif ($name -and $hh -and $hh -notmatch '^\d+$') {
        Note "$g : households '$hh' is not a number - cleared"
        $hh = ""
    }

    # ---- A county is not a city; it is the area the group covers ------------
    if ($name -and $city -match 'County') {
        $area = $city
        Note "$g : '$city' moved from City to Area it covers"
        $city = ""
    }

    # ---- An email sitting in the Phone column ------------------------------
    if ($ph -and $ph -match '@') {
        $stray = $ph
        $ph = ""
        if (-not $em) {
            $em = $stray
            Note "$g : '$stray' moved from Phone to the empty Email column"
        }
        elseif ($em -ne $stray) {
            # Two real addresses. The personal one stays with the person; the
            # shared mailbox goes to NOTES rather than being thrown away.
            $keep = $em
            $em = $stray
            $notes = (@($notes, "Group mailbox: $keep") | Where-Object { $_ }) -join "; "
            Note "$g : '$stray' moved from Phone into Email; '$keep' appended to NOTES as a group mailbox"
        }
    }

    # ---- Phone format ------------------------------------------------------
    if ($ph) {
        $digits = ($ph -replace '\D', '')
        if ($digits.Length -eq 10) {
            $norm = "({0}){1}-{2}" -f $digits.Substring(0,3), $digits.Substring(3,3), $digits.Substring(6,4)
            if ($norm -ne $ph) { Note "$g : phone '$ph' normalized to '$norm'"; $ph = $norm }
        }
        else { [void]$flags.Add("CHECK: phone '$ph' is not 10 digits") }
    }

    # ---- Email -------------------------------------------------------------
    if ($em -and $em -notmatch $emailRe) {
        # One known, unambiguous typo: a missing dot before the TLD.
        $fixed = $em -replace '@gmailcom$', '@gmail.com'
        if ($fixed -ne $em -and $fixed -match $emailRe) {
            Note "$g : email '$em' corrected to '$fixed'"
            $em = $fixed
        }
        else { [void]$flags.Add("CHECK: '$em' is not a valid email address") }
    }

    # ---- Contact -> first / last / role -------------------------------------
    $first = ""; $last = ""; $role = ""
    if ($con) {
        $parts  = $con -split ',', 2
        $person = Clean $parts[0]
        if ($parts.Count -gt 1) { $role = Clean $parts[1] }
        $words = $person -split '\s+'
        $first = $words[0]
        if ($words.Count -gt 1) { $last = ($words[1..($words.Count-1)]) -join ' ' }
        if ($role) { Note "$g : '$con' split into name '$person' and role '$role'" }
    }

    # ---- A spare email with nobody attached to it ----------------------------
    # Not a person, so it does not become a contact row. Appended to the
    # group's notes so the address survives and somebody can place it later.
    if (-not $name -and -not $con -and $em -and -not $ph) {
        if ($currentGroupRow) {
            AppendNote $currentGroupRow "Also on file: $em"
            Note "$g : '$em' had no name attached - appended to the group's NOTES"
            continue
        }
    }

    # ---- Still worth a human's eye -------------------------------------------
    if ($notes -match 'Lost Creek' -and $g -notmatch 'Lost Creek') {
        [void]$flags.Add("CHECK: note names a different group ('Lost Creek') - is this the right group?")
    }

    $row = [pscustomobject]@{
        Name = $name; Households = $hh; City = $city; Zip = $zip
        Status = $(if ($name) { $Status } else { "" })
        AreaCovers = $area; YearRecognized = ""; RenewalDue = ""
        FirstName = $first; LastName = $last; Role = $role
        Phone = $ph; Email = $em; Notes = $notes; Flags = ($flags -join " | ")
    }
    [void]$outRows.Add($row)
    if ($name) { $currentGroupRow = $row }
}

$header = @("Name","# Households","City","ZIP Code","Status","Area it covers","Year recognized","Renewal due",
            "First Name","Last Name","Role","Phone","Email","NOTES","FLAGS") -join "`t"

$lines = New-Object System.Collections.ArrayList
[void]$lines.Add($header)
foreach ($o in $outRows) {
    [void]$lines.Add((@($o.Name,$o.Households,$o.City,$o.Zip,$o.Status,$o.AreaCovers,$o.YearRecognized,
                        $o.RenewalDue,$o.FirstName,$o.LastName,$o.Role,$o.Phone,$o.Email,$o.Notes,$o.Flags) -join "`t"))
}
[System.IO.File]::WriteAllLines($Out, $lines, (New-Object System.Text.UTF8Encoding($true)))

"WROTE: $Out"
"Rows out: $($outRows.Count)   Groups: $(@($outRows | Where-Object { $_.Name }).Count)   People: $(@($outRows | Where-Object { $_.FirstName }).Count)"
""
"=== APPLIED ($($log.Count)) ==="
$log | ForEach-Object { "  $_" }
""
$still = @($outRows | Where-Object { $_.Flags })
"=== STILL FLAGGED ($($still.Count)) ==="
if (-not $still) { "  (none)" }
$g2 = ""
foreach ($o in $outRows) {
    if ($o.Name) { $g2 = $o.Name }
    if ($o.Flags) { "  {0,-34} {1}" -f $g2, $o.Flags }
}
