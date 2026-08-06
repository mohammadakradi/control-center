class: SQL injection (CWE-89). findUser concatenates `name` into the query → `name="x OR 1=1"` dumps all rows. Fix: parameterized query.
