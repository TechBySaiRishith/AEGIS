#!/bin/bash
# Query the code-review-graph SQLite database directly.
# Usage: ./scripts/graph-query.sh <command> [args]
#
# Commands:
#   overview                    - Summary of the codebase graph
#   functions [file]            - List functions (optionally filter by file path substring)
#   classes                     - List all classes
#   callers <function_name>     - Who calls this function?
#   callees <function_name>     - What does this function call?
#   imports <file_path_substr>  - What does this file import from?
#   importers <file_path_substr>- What imports this file?
#   file <file_path_substr>     - All nodes in a file
#   search <keyword>            - Full-text search across all node names
#   risk                        - Run detect-changes for risk scores

set -euo pipefail
DB=".code-review-graph/graph.db"

if [ ! -f "$DB" ]; then
  echo "No graph DB found. Run: uvx code-review-graph build"
  exit 1
fi

CMD="${1:-overview}"
ARG="${2:-}"

case "$CMD" in
  overview)
    echo "=== Graph Overview ==="
    sqlite3 "$DB" "SELECT 'Nodes:', COUNT(*) FROM nodes;"
    sqlite3 "$DB" "SELECT 'Edges:', COUNT(*) FROM edges;"
    sqlite3 "$DB" "SELECT 'Files:', COUNT(*) FROM nodes WHERE kind='File';"
    sqlite3 "$DB" "SELECT kind, COUNT(*) as cnt FROM nodes GROUP BY kind ORDER BY cnt DESC;"
    echo "=== Languages ==="
    sqlite3 "$DB" "SELECT language, COUNT(*) FROM nodes WHERE language IS NOT NULL GROUP BY language ORDER BY COUNT(*) DESC;"
    ;;
  functions)
    if [ -n "$ARG" ]; then
      sqlite3 -header "$DB" "SELECT name, file_path, line_start, line_end FROM nodes WHERE kind='Function' AND file_path LIKE '%${ARG}%' ORDER BY file_path, line_start;"
    else
      sqlite3 -header "$DB" "SELECT name, file_path, line_start FROM nodes WHERE kind='Function' ORDER BY file_path, line_start;"
    fi
    ;;
  classes)
    sqlite3 -header "$DB" "SELECT name, file_path, line_start, line_end FROM nodes WHERE kind='Class' ORDER BY file_path;"
    ;;
  callers)
    [ -z "$ARG" ] && echo "Usage: graph-query.sh callers <function_name>" && exit 1
    sqlite3 -header "$DB" "
      SELECT e.source_qualified as caller, e.file_path, e.line
      FROM edges e
      WHERE e.kind='CALLS' AND e.target_qualified LIKE '%::${ARG}'
      ORDER BY e.file_path, e.line;"
    ;;
  callees)
    [ -z "$ARG" ] && echo "Usage: graph-query.sh callees <function_name>" && exit 1
    sqlite3 -header "$DB" "
      SELECT e.target_qualified as callee, e.file_path, e.line
      FROM edges e
      WHERE e.kind='CALLS' AND e.source_qualified LIKE '%::${ARG}'
      ORDER BY e.file_path, e.line;"
    ;;
  imports)
    [ -z "$ARG" ] && echo "Usage: graph-query.sh imports <file_path_substr>" && exit 1
    sqlite3 -header "$DB" "
      SELECT e.target_qualified as imports_from, e.line
      FROM edges e
      WHERE e.kind='IMPORTS_FROM' AND e.file_path LIKE '%${ARG}%'
      ORDER BY e.line;"
    ;;
  importers)
    [ -z "$ARG" ] && echo "Usage: graph-query.sh importers <file_path_substr>" && exit 1
    sqlite3 -header "$DB" "
      SELECT e.source_qualified as imported_by, e.file_path, e.line
      FROM edges e
      WHERE e.kind='IMPORTS_FROM' AND e.target_qualified LIKE '%${ARG}%'
      ORDER BY e.file_path;"
    ;;
  file)
    [ -z "$ARG" ] && echo "Usage: graph-query.sh file <file_path_substr>" && exit 1
    sqlite3 -header "$DB" "
      SELECT kind, name, line_start, line_end, signature
      FROM nodes
      WHERE file_path LIKE '%${ARG}%' AND kind != 'File'
      ORDER BY line_start;"
    ;;
  search)
    [ -z "$ARG" ] && echo "Usage: graph-query.sh search <keyword>" && exit 1
    sqlite3 -header "$DB" "
      SELECT kind, name, file_path, line_start
      FROM nodes
      WHERE name LIKE '%${ARG}%'
      ORDER BY file_path, line_start;"
    ;;
  risk)
    uvx code-review-graph detect-changes 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Risk score: {d[\"risk_score\"]}')
print(f'Summary: {d[\"summary\"]}')
for f in d.get('changed_functions', [])[:10]:
    print(f'  {f[\"name\"]} ({f[\"file_path\"].split(\"/\")[-1]}:{f[\"line_start\"]}) risk={f[\"risk_score\"]}')
" 2>/dev/null || uvx code-review-graph detect-changes 2>&1 | head -30
    ;;
  *)
    echo "Unknown command: $CMD"
    echo "Commands: overview, functions, classes, callers, callees, imports, importers, file, search, risk"
    exit 1
    ;;
esac
