// Runs before every npm script that needs modern Node. Plain CommonJS so
// that it works on any Node version and can explain the problem.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`
Threadline needs Node.js 22.18 or later. This terminal is using ${process.version}.

If you use nvm, run these in this folder:
  nvm install    (once; installs the version in .nvmrc)
  nvm use        (each new terminal)
`);
  process.exit(1);
}
