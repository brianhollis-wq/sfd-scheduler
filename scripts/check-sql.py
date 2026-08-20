#!/usr/bin/env python3
"""
Check the db/*.sql migrations before they are pasted into Supabase.

Syntax alone is not enough. The bug this exists to prevent — apparatus tuples
pasted into a list of employee IDs — is valid PostgreSQL syntax and fails only
at execution, with "operator does not exist: integer = record". So this walks
the parse tree and rejects any IN list whose elements are not all the same kind
of value.

Usage:  python3 scripts/check-sql.py [files...]     (defaults to db/*.sql)
"""
import sys
import pathlib

try:
    import pglast
    from pglast import ast, enums, visitors
except ImportError:
    sys.exit('pglast is required:  pip install pglast')

AEXPR_IN = enums.parsenodes.A_Expr_Kind.AEXPR_IN


def value_kind(node):
    """Classify one element of an IN list."""
    if isinstance(node, ast.TypeCast):
        return value_kind(node.arg)
    if isinstance(node, ast.RowExpr):
        return 'tuple'
    if isinstance(node, ast.A_Const):
        val = node.val
        if isinstance(val, ast.Integer):
            return 'integer'
        if isinstance(val, ast.String):
            return 'string'
        if isinstance(val, ast.Float):
            return 'number'
        return 'constant'
    return 'expression'


def check(path):
    sql = path.read_text()
    try:
        root = pglast.parse_sql(sql)
    except Exception as exc:
        return [f'does not parse: {exc}']

    problems = []

    class InListVisitor(visitors.Visitor):
        def visit_A_Expr(self, ancestors, node):
            if node.kind != AEXPR_IN:
                return
            rhs = node.rexpr
            if not isinstance(rhs, (list, tuple)):
                return
            kinds = sorted({value_kind(e) for e in rhs})
            if 'tuple' in kinds:
                problems.append(
                    'IN list contains a tuple, which cannot be compared to a '
                    'scalar column — this is text pasted into the wrong list'
                )
            elif len(kinds) > 1:
                problems.append(f'IN list mixes {" and ".join(kinds)} values')

    for stmt in root:
        InListVisitor()(stmt)
    return problems


def main():
    paths = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(pathlib.Path('db').glob('*.sql'))
    if not paths:
        sys.exit('no .sql files found')

    failed = False
    for path in paths:
        problems = check(path)
        if problems:
            failed = True
            print(f'  FAIL  {path.name}')
            for p in problems:
                print(f'          {p}')
        else:
            print(f'  OK    {path.name}')

    if failed:
        print('\nfix the above before running these in Supabase')
        sys.exit(1)
    print('\nall migrations pass')


if __name__ == '__main__':
    main()
