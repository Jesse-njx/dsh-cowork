---
name: dsh-cowork
description: Read and write office documents and Jupyter notebooks (xlsx, pdf, docx, pptx, ipynb) with bounded windows and stable cell/slide addresses.
---

# DSH Cowork (doc-read / doc-write)

Use the `doc-read` / `doc-write` CLI to work with binary documents instead of
trying to read them as text.

## When to use

- The user asks to read, summarize, extract from, or edit an `.xlsx`, `.pdf`,
  `.docx`, `.pptx`, or `.ipynb` file.
- A file does not open with your normal text reader.

## doc-read

```sh
doc-read <file> [--page N] [--pages N] [--sheets a,b] [--row-offset N] [--rows N] \
  [--slide N] [--slides N] [--cell N] [--cells N] [--max-bytes N] [--json]
```

- xlsx results are markdown tables with **cell refs** (`A1`, `C12`) — use them
  as addresses for edits.
- pdf/pptx/ipynb support page/slide/cell windows. Always window large files:
  start with the default window, then pass offsets to continue.
- A `> Truncated:` line means the window was cut short — continue with a
  higher offset rather than guessing at the rest.
- `--json` prints the structured window (addresses, formulas, notices) instead
  of markdown.

## doc-write

```sh
doc-write create <file> <xlsx|ipynb> --spec spec.json [--force]
doc-write edit <file> --spec spec.json [--force]
```

Spec shapes:

- xlsx create: `{"sheets":[{"name":"S1","cells":[{"ref":"A1","value":42}]}]}`
  — values may be string/number/boolean/null or `{"formula":"SUM(A1:A2)"}`.
- xlsx edit: `{"format":"xlsx","edits":[{"sheet":"S1","ref":"A1","value":"x"}]}`
- ipynb create: `{"cells":[{"type":"markdown","source":"# Hi"},{"type":"code","source":"print(1)"}]}`
- ipynb edit: `{"format":"ipynb","edits":[{"op":"replace","cell":0,"source":"..."}]}`
  (`op` ∈ replace | insert | delete; insert takes `at` + `cells`)

Rules:

- Writes are atomic (temp file + rename). Never write a macro-enabled format
  (xlsm/docm/pptm) — they are rejected.
- `--force` is required to overwrite an existing file.
- After an edit, re-read the file with `doc-read` to verify before telling the
  user it succeeded.
