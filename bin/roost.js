#!/usr/bin/env node
// roost: your Claude Code background sessions in one place.
//   roost            the session list
//   roost init       set up the tools roost reads from (tracker, GitHub, ...)
//   roost pet        build and start the desktop pet (macOS)
//   roost --demo     made-up sessions and tickets, to show or record roost
const sub = process.argv[2];
const demo = process.argv.includes('--demo') || process.env.ROOST_DEMO === '1';
if (demo) process.env.ROOST_DEMO = '1';
if (sub === 'init') { await (await import('../src/init.js')).runInit(); process.exit(0); }
if (sub === 'pet') { await (await import('../src/petcmd.js')).runPet(process.argv.slice(3)); process.exit(0); }

const {render} = await import('ink');
const {installFlickerFreeOutput, suspendOutput} = await import('../src/terminal.js');
const {html} = await import('../src/ui/components.js');
const {App} = await import('../src/ui/App.js');
const data = await import('../src/data.js');
const {loadCachedStatuses, refreshStatuses, loadCachedTicketPrs, searchTicketPrs} = await import('../src/pr.js');
const {loadCachedIssues, refreshIssues, issueUrl, trackerLabel} = await import('../src/tracker.js');
const {searchTranscripts} = await import('../src/search.js');
const {markSeen} = await import('../src/attention.js');
const {listen} = await import('../src/control.js');
const {paneSupported, openPane, closeAllPanes, hasPanes, prunePanes, closeOwnPane, warmPanes, paneKeySequence} = await import('../src/pane.js');
const {config, setConfigValue} = await import('../src/config.js');

for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

installFlickerFreeOutput();

let services = {...data, refreshStatuses, searchTicketPrs, refreshIssues, issueUrl, trackerLabel, searchTranscripts, markSeen, listen,
  paneSupported, openPane, closeAllPanes, hasPanes, prunePanes, closeOwnPane, paneKeySequence, setConfigValue};
const cardAt0 = process.argv.indexOf('--card');
if (demo) {
  const {demoServices, setDemoFlag} = await import('../src/demo.js');
  services = demoServices(services);
  // The pane's card is a second roost: only the main one tells the pet.
  if (cardAt0 < 0) {
    setDemoFlag(true);
    process.on('exit', () => setDemoFlag(false));
  }
}
const at = process.argv.indexOf('--open');
const openId = at > 0 ? process.argv[at + 1] : null;
const cardAt = process.argv.indexOf('--card');
const paneId = cardAt > 0 ? process.argv[cardAt + 1] : null;
// Opened from the pet: go straight into the session; the list is painted only
// once you leave it, so it never flashes first.
if (openId) suspendOutput();
if (!paneId) { if (!demo) data.refreshIndex(); warmPanes(); }
const app = render(html`<${App} services=${services} initial=${demo ? {openId, paneId, animations: config().animations, paneAlwaysOpen: config().paneAlwaysOpen} : {statuses: loadCachedStatuses(), issues: loadCachedIssues(), ticketPrs: loadCachedTicketPrs(), openId, paneId, launchMode: config().launchPermissionMode, animations: config().animations, paneAlwaysOpen: config().paneAlwaysOpen}} />`, {exitOnCtrlC: true});
await app.waitUntilExit();
app.clear();
if (hasPanes()) await Promise.race([closeAllPanes(), new Promise(res => setTimeout(res, 1000))]);
