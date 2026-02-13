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
  <title>Klovan Ekipa</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Nunito', sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
    }
    .container {
      background: linear-gradient(145deg, #2a2a4a, #1e1e3a);
      border: 2px solid #e94560;
      border-radius: 24px;
      padding: 40px 32px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 0 40px rgba(233, 69, 96, 0.3), 0 20px 60px rgba(0,0,0,0.5);
      position: relative;
    }
    .container::before {
      content: '';
      position: absolute;
      top: -2px; left: -2px; right: -2px; bottom: -2px;
      background: linear-gradient(45deg, #e94560, #f5a623, #e94560, #f5a623);
      border-radius: 26px;
      z-index: -1;
      background-size: 300% 300%;
      animation: border-glow 3s ease infinite;
    }
    @keyframes border-glow {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    .icon { font-size: 72px; margin-bottom: 16px; }
    h1 {
      font-family: 'Fredoka One', cursive;
      color: #f5a623;
      margin-bottom: 8px;
      font-size: 26px;
      text-shadow: 0 0 20px rgba(245, 166, 35, 0.4);
    }
    .username {
      color: #e94560;
      font-weight: 700;
      font-size: 18px;
    }
    p { color: #ccc; line-height: 1.7; margin-bottom: 18px; font-size: 15px; }
    .steps {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(233, 69, 96, 0.2);
      border-radius: 14px;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }
    .step {
      display: flex;
      align-items: center;
      margin-bottom: 14px;
      color: #ddd;
      font-size: 14px;
    }
    .step:last-child { margin-bottom: 0; }
    .step-icon {
      font-size: 22px;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #e94560, #c0392b);
      color: white;
      padding: 14px 32px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 700;
      font-size: 16px;
      margin-top: 10px;
      transition: all 0.3s;
      box-shadow: 0 4px 20px rgba(233, 69, 96, 0.4);
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 30px rgba(233, 69, 96, 0.6);
    }
    .footer { margin-top: 28px; color: #666; font-size: 13px; }
    .neon-text {
      color: #e94560;
      text-shadow: 0 0 10px rgba(233, 69, 96, 0.6);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${alreadyMember ? '🎪' : '🤡'}</div>
    <h1>${alreadyMember ? 'Vec si u ekipi, brate!' : 'Pozivnica poslata!'}</h1>
    <p>
      E <span class="username">@${user.login}</span>!<br>
      ${alreadyMember
        ? 'Ti si vec clan <span class="neon-text">Klovan</span> ekipe, legendo! Nema potrebe za invite.'
        : 'Poslali smo ti pozivnicu za <span class="neon-text">Klovan</span> organizaciju na GitHub-u. Samo prihvati i postajes deo ekipe!'}
    </p>

    ${alreadyMember ? '' : `<div class="steps">
      <div class="step">
        <div class="step-icon">🔔</div>
        <div>Proveri <strong>GitHub notifikacije</strong> (zvonce gore desno)</div>
      </div>
      <div class="step">
        <div class="step-icon">📧</div>
        <div>Ili pogledaj <strong>email</strong> od GitHub-a</div>
      </div>
      <div class="step">
        <div class="step-icon">✅</div>
        <div>Klikni <strong>"Accept invitation"</strong></div>
      </div>
      <div class="step">
        <div class="step-icon">🍺</div>
        <div>Cestitamo, sad si deo kafanske ekipe!</div>
      </div>
    </div>`}

    <a href="https://github.com/orgs/${orgName}/invitation" class="btn">
      ${alreadyMember ? 'Idi na organizaciju' : 'Otvori GitHub pozivnicu'}
    </a>

    <div class="footer">
      Mozes zatvoriti ovu stranicu. Vidimo se u kodu! 🍻
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
  <title>Greska - Klovan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #1a1a2e;
      padding: 20px;
    }
    .error {
      background: #2a2a4a;
      border: 2px solid #e94560;
      padding: 40px;
      border-radius: 16px;
      text-align: center;
      max-width: 400px;
    }
    .icon { font-size: 60px; margin-bottom: 16px; }
    h1 { color: #e94560; margin-bottom: 10px; }
    p { color: #999; }
    .btn {
      display: inline-block;
      background: #e94560;
      color: white;
      padding: 12px 24px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="error">
    <div class="icon">💀</div>
    <h1>Nesto je krenulo naopako</h1>
    <p>Probaj ponovo ili javi adminu.</p>
    <a href="${process.env.API_BASE}/api/github/join" class="btn">Probaj ponovo</a>
  </div>
</body>
</html>`);
  }
}
