# Printing labels

ZweTag prints from the **Print** page through your browser's print dialog (the desktop program uses
the same dialog). Every cable gives two labels, end A first, then end B. Each label has three lines:
the address of its own end, an arrow and the address of the other end, and the cable code, type and
length.

## Label sheets on a laser or inkjet printer

Two common sheet formats are built in:

| Layout | Sheet | Labels | Label size |
|---|---|---|---|
| A4 · 3 × 8 | A4 | 24 per sheet | 63.5 × 33.9 mm |
| Letter · 3 × 10 | US Letter | 30 per sheet | 66.7 × 25.4 mm (2 5/8 × 1 in) |

For any other sheet choose **Custom** and enter the page size, the number of columns and rows, the
label size, the top and left margins and the gaps between labels, all in millimeters. Measure from the
paper edge to the edge of the first label.

1. Print one page on plain paper first, with **Outlines** on. Hold it against a label sheet in front
   of a light: the outlines should sit on the label edges.
2. In the print dialog, print at **100 %** ("Actual size"). Turn off "Fit to page", page headers and
   footers, and set the margins to none if the dialog offers them.
3. A sheet you have already used partly can go through again: set **Skip first labels** to the number
   of labels that are gone. They are counted row by row from the top left.

**Repeat text** prints the text block two or three times on each label. Use it for self-laminating
cable labels that wrap around the cable, so the text can be read from any side.

If a label shows a red outline in the preview and the page says *Text does not fit this label size*,
the text would be smaller than 6 pt. Use a larger label, fewer repeats, or turn off **Third line**.

## Label printers

Choose **Single label** and enter the width and height of your labels or tape. Each label becomes one
page of exactly that size. In the print dialog pick the label printer and set its paper size to the
same label size.

Most label printers also come with their own design software that can import a CSV file. On the
**Cables** page, **Labels CSV** writes one row per label:

| Column | Content |
|---|---|
| `code` | Cable code |
| `side` | `A` or `B` |
| `line1` | Address of this end |
| `line2` | Arrow and the address of the other end |
| `line3` | Cable code, type and length |

Link `line1`, `line2` and `line3` to the text fields of a label design in that software and print
from there. The export covers the selected cables, or every cable the filters show when nothing is
selected. The file is UTF-8 with a byte order mark, which spreadsheet programs and most label
software read correctly.

## After printing

When the print dialog closes, ZweTag asks whether to mark the printed cables as labeled. A labeled
cable whose address changes later (the device moved, a rack was renamed) shows **Relabel** in the
cable list until it is printed and marked again.
