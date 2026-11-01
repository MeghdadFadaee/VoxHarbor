# Third-party software

The root MIT license covers VoxHarbor's original code. Third-party code retains its own copyright and license terms.

| Component | Version / provenance | License and retained notices |
| --- | --- | --- |
| ReSpeak tsclientlib, tsproto and bookkeeping/declaration sources | Exact revisions and source archive digests in `native/vendor/provenance.json`; local patches recorded there | MIT OR Apache-2.0; retain `native/vendor/tsclientlib/LICENSE-MIT`, `LICENSE-APACHE`, and declaration license files |
| libopus-wasm | 0.3.0, pinned in `package-lock.json` | MIT wrapper license at `public/vendor/opus/LICENSE`; upstream notices at `public/vendor/opus/THIRD_PARTY_NOTICES.md` |
| libopus compiled into the bundled WASM | 1.6.1, as documented by libopus-wasm 0.3.0 | BSD-style copyright, redistribution and patent notices retained in `public/vendor/opus/COPYING.libopus` |
| IBM Plex Sans and IBM Plex Mono | Official Google Fonts distribution; original fonts © IBM Corp. | SIL Open Font License 1.1 at `public/fonts/OFL.txt`; locally hosted font files are unmodified |
| ws, ipaddr.js and build dependencies | Pinned Node/Cargo lockfiles | Original package notices are supplied by their distributions; dependencies/build outputs are not vendored into this source export |

The libopus notice is copied from the [versioned upstream COPYING file](https://github.com/xiph/opus/blob/v1.6.1/COPYING). Build preparation preserves it alongside the generated browser codec. Vendored Rust sources are kept intact apart from the separately recorded patches. Upstream source references are not endorsements of VoxHarbor.

If you distribute compiled artifacts, preserve the notices required by all linked dependencies as well as these source notices. TeamSpeak names and marks belong to their respective owners; this project is independent.
