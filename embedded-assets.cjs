// Dev-mode placeholder. In a normal dev/test run the server reads static files
// from disk (`web/` + `node_modules/katex/dist`) and this export is `null`.
//
// The single-file build (`npm run build:server`) replaces this module with the
// real embedded asset map via an esbuild virtual plugin, so the produced bundle
// (and the SEA binary built from it) is fully self-contained.
module.exports = null;
