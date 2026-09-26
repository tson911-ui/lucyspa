# Local common/compromised password blocklist

Source: [SecLists Xato top 100,000 passwords](https://github.com/danielmiessler/SecLists/blob/c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt),
from the maintained SecLists project. The source corpus contains previously
published common passwords; this is not an exhaustive breach database.

- Pinned source commit: `c205c36a445bff37f8e58a9ec829105cd4975c58`.
- Source file last change: 2025-05-08; reviewed for this snapshot 2026-09-24.
- Source SHA-256: `1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`.
- License: upstream MIT, reproduced in [LICENSE](LICENSE).
- Generated entries: 39,329 unique SHA-256 fingerprints after NFC normalization and
  retaining passwords with 8–128 Unicode code points (regenerated 2026-09-26 when the
  Owner lowered the global minimum from 15 to 8; the earlier snapshot kept only the 72
  entries of 15+ code points). Every other source entry already fails Lucy Spa's length
  policy. Matching preserves case and spaces.

These fingerprints represent **public blocklist words only**, not user
credentials. Account passwords always use Argon2id. No runtime password or hash
is sent to any third party. The blocklist is enforced when setting/resetting a
password; verification and cost-only rehash do not retroactively apply it.

To reproduce, download the pinned source separately and run:

```sh
node apps/api/src/auth/password-data/generate.mjs /path/to/source.txt
```

The generator verifies the full source checksum before writing its generated
TypeScript module. To update, review upstream provenance/license, pin the new
commit and checksum in the generator and this file, regenerate, run password
tests, and review the resulting diff. Review updates with authentication
dependency maintenance and before enabling password-setting flows for launch.
An expanded corpus can be introduced through that review; absence from this
finite snapshot is not a guarantee that a password has never been compromised.
