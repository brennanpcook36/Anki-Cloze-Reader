function launchAnki(platform = process.platform, execFile = require('node:child_process').execFile) {
  if (platform !== 'darwin') return Promise.reject(new Error('Open Anki is currently supported on macOS only.'));
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', 'Anki'], error => {
      if (error) reject(new Error('Anki could not be opened. Make sure Anki is installed in Applications.'));
      else resolve({ launched: true });
    });
  });
}

function isAnkiRunning(platform = process.platform, execFile = require('node:child_process').execFile) {
  if (platform !== 'darwin') return Promise.resolve(false);
  return new Promise(resolve => execFile('/usr/bin/pgrep', ['-x', 'Anki'], error => resolve(!error)));
}

module.exports = { launchAnki, isAnkiRunning };
