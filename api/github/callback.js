import { pool } from "../../lib/db.js";

export default async function handler(req, res) {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send('Missing code parameter');
    }

    // 1. Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      throw new Error('Failed to get access token');
    }

    // 2. Get user info from GitHub
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    const user = await userRes.json();

    // 3. Send org invite via GitHub API
    const inviteRes = await fetch(`https://api.github.com/orgs/${process.env.GITHUB_ORG_NAME}/invitations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_ORG_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        invitee_id: user.id,
        role: 'direct_member'
      })
    });

    let alreadyMember = false;
    if (!inviteRes.ok) {
      const errorData = await inviteRes.json();
      console.error('GitHub invite error:', errorData);
      // User may already be invited or a member
      if (errorData.errors?.some(e => e.message?.includes('already'))) {
        alreadyMember = true;
      }
    }

    // 4. Save to database
    await pool.query(
      `INSERT INTO github_contributors
       (github_id, github_username, github_avatar_url, github_email, invite_status, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (github_id)
       DO UPDATE SET
         invited_at = NOW(),
         github_username = EXCLUDED.github_username,
         github_avatar_url = EXCLUDED.github_avatar_url,
         github_email = EXCLUDED.github_email,
         user_agent = EXCLUDED.user_agent,
         ip_address = EXCLUDED.ip_address`,
      [
        user.id,
        user.login,
        user.avatar_url,
        user.email,
        alreadyMember ? 'accepted' : 'pending',
        req.headers['user-agent'],
        req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
      ]
    );

    // 5. Return success HTML page
    const orgName = process.env.GITHUB_ORG_NAME;
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invite Sent - Clown Project</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .icon { font-size: 80px; margin-bottom: 20px; }
    h1 { color: #333; margin-bottom: 10px; font-size: 28px; }
    .username { color: #667eea; font-weight: bold; }
    p { color: #666; line-height: 1.6; margin-bottom: 20px; }
    .steps {
      background: #f7f7f7;
      border-radius: 10px;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }
    .step {
      display: flex;
      align-items: start;
      margin-bottom: 15px;
    }
    .step:last-child { margin-bottom: 0; }
    .step-number {
      background: #667eea;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .btn {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 12px 30px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 10px;
    }
    .btn:hover { background: #5568d3; }
    .footer { margin-top: 30px; color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${alreadyMember ? '🎉' : '✅'}</div>
    <h1>${alreadyMember ? 'Already a Member!' : 'Invite Sent!'}</h1>
    <p>
      Hey <span class="username">@${user.login}</span>! 👋<br>
      ${alreadyMember
        ? 'You are already a member of the <strong>Clown Project</strong> organization!'
        : 'We\'ve sent you an invitation to join the <strong>Clown Project</strong> organization on GitHub.'}
    </p>

    ${alreadyMember ? '' : `<div class="steps">
      <div class="step">
        <div class="step-number">1</div>
        <div>Check your <strong>GitHub notifications</strong> (bell icon on GitHub)</div>
      </div>
      <div class="step">
        <div class="step-number">2</div>
        <div>Or check your <strong>email</strong> from GitHub</div>
      </div>
      <div class="step">
        <div class="step-number">3</div>
        <div>Click <strong>"Accept invitation"</strong></div>
      </div>
      <div class="step">
        <div class="step-number">4</div>
        <div>Start contributing! 🚀</div>
      </div>
    </div>`}

    <a href="https://github.com/orgs/${orgName}/invitation" class="btn">
      ${alreadyMember ? 'Go to Organization' : 'Open GitHub Notifications'}
    </a>

    <div class="footer">
      You can close this page now.
    </div>
  </div>
</body>
</html>`);

  } catch (error) {
    console.error('GitHub callback error:', error);

    res.status(500).setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Clown Project</title>
  <style>
    body {
      font-family: sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5f5;
      padding: 20px;
    }
    .error {
      background: white;
      padding: 40px;
      border-radius: 10px;
      text-align: center;
      max-width: 400px;
    }
    h1 { color: #e53e3e; margin-bottom: 10px; }
    p { color: #666; }
    .btn {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 10px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="error">
    <h1>Something went wrong</h1>
    <p>Please try again or contact support.</p>
    <a href="${process.env.API_BASE}/api/github/join" class="btn">Try Again</a>
  </div>
</body>
</html>`);
  }
}
