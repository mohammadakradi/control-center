class: SSRF (CWE-918). fetchImage fetches an arbitrary user URL → http://169.254.169.254/ (cloud metadata), file://, internal services. Fix: allowlist hosts/schemes, block private IPs.
