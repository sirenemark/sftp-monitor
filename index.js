const SftpClient = require('ssh2-sftp-client');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const sftp = new SftpClient();

const CONFIG = {
  host: 'bekadrive.synology.me',
  port: 22221,
  username: process.env.SFTP_USER,
  password: process.env.SFTP_PASS,
  remoteDir: '/home'
};

async function run() {

  const startTime = new Date();

  let files = [];
  let recentFiles = [];
  let newFiles = [];

  const status = {
    overall: 'OK',
    sftp: 'NOT STARTED',
    sheets: 'NOT STARTED',
    email: 'NOT STARTED',
    errors: []
  };

  let body = '';

  console.log('==============================');
  console.log('SFTP MONITOR STARTING');
  console.log(startTime.toISOString());
  console.log('==============================');

  //
  // SFTP
  //

  try {

    console.log('Connecting to SFTP...');

    await sftp.connect({
      host: CONFIG.host,
      port: CONFIG.port,
      username: CONFIG.username,
      password: CONFIG.password,
      readyTimeout: 60000
    });

    status.sftp = 'OK';

    console.log('Connected to SFTP');

    files = (await sftp.list(CONFIG.remoteDir))
      .sort((a, b) => b.modifyTime - a.modifyTime);

    console.log(`Found ${files.length} total files`);

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    recentFiles = files.filter(file => {

      const modified =
        file.modifyTime > 9999999999
          ? file.modifyTime
          : file.modifyTime * 1000;

      return modified >= (now - DAY_MS);
    });

    console.log(`Found ${recentFiles.length} recent files`);

  } catch (err) {

    status.sftp = 'FAILED';
    status.overall = 'ERROR';

    const msg = `SFTP ERROR: ${err.message}`;

    status.errors.push(msg);

    console.error(msg);
  }

  //
  // GOOGLE SHEETS
  //

  if (status.sftp === 'OK') {

    try {

      console.log('Authenticating Google Sheets...');

      const googleCreds = JSON.parse(process.env.GOOGLE_CREDS_JSON);

      const serviceAccountAuth = new JWT({
        email: googleCreds.client_email,
        key: googleCreds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const doc = new GoogleSpreadsheet(
        process.env.SHEET_ID,
        serviceAccountAuth
      );

      await doc.loadInfo();

      const sheet = doc.sheetsByIndex[0];

      const rows = await sheet.getRows();

      const existing = rows.map(r => r.filename);

      newFiles = recentFiles.filter(f => !existing.includes(f.name));

      for (const file of newFiles) {

        await sheet.addRow({
          filename: file.name,
          modified: new Date(file.modifyTime).toISOString(),
          detected: new Date().toISOString()
        });
      }

      status.sheets = 'OK';

      console.log(`Added ${newFiles.length} new rows to Google Sheets`);

    } catch (err) {

      status.sheets = 'FAILED';
      status.overall = 'ERROR';

      const msg = `GOOGLE SHEETS ERROR: ${err.message}`;

      status.errors.push(msg);

      console.error(msg);
    }
  }

  //
  // BUILD EMAIL
  //

  body += `SFTP Daily Monitor Report - ${status.overall}\n\n`;

  body += `Time:\n`;
  body += `${startTime.toISOString()}\n\n`;

  body += `System Status:\n`;
  body += `- SFTP: ${status.sftp}\n`;
  body += `- Google Sheets: ${status.sheets}\n\n`;

  body += `Statistics:\n`;
  body += `- Total files on SFTP: ${files.length}\n`;
  body += `- Files uploaded within 24h: ${recentFiles.length}\n`;
  body += `- Newly detected files: ${newFiles.length}\n\n`;

  if (recentFiles.length > 0) {

    body += `Recent files:\n`;

    recentFiles.slice(0, 10).forEach(file => {

      body += `- ${file.name}\n`;
    });

    body += `\n`;
  }

  if (status.errors.length > 0) {

    body += `Errors:\n`;

    status.errors.forEach(err => {

      body += `- ${err}\n`;
    });

    body += `\n`;
  }

  if (
    status.sftp === 'OK' &&
    recentFiles.length === 0
  ) {

    body += `WARNING:\n`;
    body += `No uploads were detected within the last 24 hours.\n\n`;
  }

  //
  // EMAIL
  //

  try {

    console.log('Sending email report...');

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.ALERT_EMAIL,
      subject: `SFTP Monitor - ${status.overall}`,
      text: body
    });

    status.email = 'OK';

    console.log('Email sent successfully');

  } catch (err) {

    status.email = 'FAILED';

    const msg = `EMAIL ERROR: ${err.message}`;

    console.error(msg);

    console.log('\n========== EMAIL BODY ==========');
    console.log(body);
    console.log('================================\n');
  }

  //
  // CLEANUP
  //

  try {

    await sftp.end();

  } catch (err) {

    console.log('SFTP cleanup skipped');
  }

  console.log('==============================');
  console.log('SFTP MONITOR FINISHED');
  console.log('==============================');
}

run().catch(err => {

  console.error('FATAL ERROR:', err);
});
