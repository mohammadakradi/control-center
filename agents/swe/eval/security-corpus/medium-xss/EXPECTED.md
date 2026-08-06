class: Reflected XSS (CWE-79). `q` is interpolated into HTML unescaped → ?q=<script>... runs. Fix: HTML-escape or set proper templating/escaping.
