# Browser DOS emulator source and notices

The five unmodified runtime files beside this notice come from official npm `emulators@8.5.2`: `emulators.js`, `wdosbox.js`, `wdosbox.wasm`, `wlibzip.js` and `wlibzip.wasm`. The upstream declared license is GPL-2.0. The original GPL text is supplied in [LICENSE](LICENSE); retain it and the [third-party notices](THIRD-PARTY-NOTICES.txt) with this distribution.

The corresponding source is available without an account or charge from this same directory: [emulators-8.5.2-source.tar.gz](emulators-8.5.2-source.tar.gz). It includes the exact DOSBox source, API and worker glue, original build scripts, a minimal subset build helper, libzip, SDL_net, embedded JavaScript dependency source/notices, and Emscripten's zlib port source. This is present source delivery under GPLv2 section 3(a) and the final paragraph of section 3, rather than a future written offer under section 3(b). Keep this source download accessible for as long as these binaries remain accessible.

| Component | Exact upstream identity | Official source |
| --- | --- | --- |
| emulators | 8.5.2, tag v8.5.2, commit 6bbf0925d221a7304ea8e0dda1e89b8dc01569b2 | [release source](https://github.com/js-dos/emulators/tree/6bbf0925d221a7304ea8e0dda1e89b8dc01569b2) |
| DOSBox core | gitlink commit 528578d5a6f76afd4d5ef4e722b5670826f1183a | [exact source](https://github.com/js-dos/dosbox/tree/528578d5a6f76afd4d5ef4e722b5670826f1183a) |
| libzip and SDL_net | source vendored in the emulators commit above | Included source headers retain their original BSD and zlib-style notices. |
| core-js | 3.30.0, MIT | [official package](https://registry.npmjs.org/core-js/-/core-js-3.30.0.tgz) |
| browser-pack | 6.1.0, MIT | [official package](https://registry.npmjs.org/browser-pack/-/browser-pack-6.1.0.tgz) |
| process browser shim | 0.11.10, MIT | [official package](https://registry.npmjs.org/process/-/process-0.11.10.tgz) |
| zlib | 1.3.1, exact hash selected by Emscripten 5.0.2 | [official source](https://github.com/madler/zlib/tree/v1.3.1) |
| Emscripten build SDK | 5.0.2, commit dc80f645ee70178c11666de0c3860d9e064d50e4 | [exact source](https://github.com/emscripten-core/emscripten/tree/dc80f645ee70178c11666de0c3860d9e064d50e4) |

The package's official npm [metadata](https://registry.npmjs.org/emulators/8.5.2) identifies the source gitHead and distribution integrity. Its SHA-1/SHA-512 integrity and official tag were verified. The published source map's 83 real source texts match the exact source and JavaScript dependency versions. The generated `src/build.ts` is taken from that published map; the older generated Git snapshot is separately preserved. Source and binary SHA-256 hashes are recorded in [SOURCE-PROVENANCE.json](SOURCE-PROVENANCE.json).

Upstream release CI uses Node.js 22, Emscripten 5.0.2, CMake and Ninja. The archive includes those build instructions and `emulators/vendor-build/build.sh`, which builds only the distributed DOSBox and ZIP targets and preserves upstream compile/link settings. Unused DOSBox-X/Sokol backends, benchmarks and game fixtures are omitted. Bash/Node syntax and CMake target/source configuration passed. A complete Emscripten rebuild was not executed; byte-for-byte reproducibility is not claimed. No runtime vendor file was patched.

The archive README describes all packaging adjustments and build steps. If a distributed runtime file is changed, update its corresponding source and this provenance together. GPLv2's license requirements are in the included original license and [official license text](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html).
