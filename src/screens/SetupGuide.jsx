import { useState } from 'react'

export default function SetupGuide({ profile }) {
  const [copied, setCopied] = useState(false)

  const ingestUrl = 'https://tofrboakpcmjvrixxxtl.supabase.co/functions/v1/ingest-sms'

  function copy(text) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="guide-screen">
      <div className="guide-head">
        <h3>SMS Forwarder Setup</h3>
        <div className="sub">Connect the company phone to the portal — one-time setup</div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr', paddingBottom: 20 }}>
        <div className="card">
          <h3><i className="fas fa-info-circle" /> What this does</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#4b637c' }}>
            The company phone receives Airtel Money and MTN MoMo merchant SMS.
            An Android app on that phone watches for those messages and forwards them to your portal.
            When they arrive, every whitelisted company phone gets a popup — attendants type a 2-digit code
            to claim the transaction.
          </p>
        </div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr', paddingBottom: 20 }}>
        <div className="card">
          <h3><i className="fas fa-link" /> Your ingest URL</h3>
          <div className="field-hint">
            <i className="fas fa-key" />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all' }}>
                {ingestUrl}
              </div>
            </div>
          </div>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => copy(ingestUrl)}>
            <i className="fas fa-copy" /> {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr', paddingBottom: 20 }}>
        <div className="card">
          <h3><i className="fas fa-list-ol" /> Setup steps</h3>

          <div className="step">
            <div className="step-num">1</div>
            <div className="step-body">
              <strong>Install MacroDroid on the company phone</strong>
              <p>Download from Google Play Store. Free version is enough. It's the easiest SMS forwarder for Uganda.</p>
            </div>
          </div>

          <div className="step">
            <div className="step-num">2</div>
            <div className="step-body">
              <strong>Open MacroDroid → Add Macro</strong>
              <p>Choose trigger → SMS Received</p>
            </div>
          </div>

          <div className="step">
            <div className="step-num">3</div>
            <div className="step-body">
              <strong>Configure the SMS trigger</strong>
              <p>Senders: <code>AirtelMoney</code> and <code>MTNMoMo</code></p>
              <p>You can also leave it as <em>Any sender</em> — the app will still only forward ones matching the patterns.</p>
            </div>
          </div>

          <div className="step">
            <div className="step-num">4</div>
            <div className="step-body">
              <strong>Add an HTTP Request action</strong>
              <p>Set method to <code>POST</code></p>
              <p>URL:</p>
              <div className="mono-box">{ingestUrl}</div>
              <p style={{ marginTop: 8 }}>Content-Type header: <code>application/json</code></p>
            </div>
          </div>

          <div className="step">
            <div className="step-num">5</div>
            <div className="step-body">
              <strong>Body (JSON)</strong>
              <p>Paste this JSON body. MacroDroid variables will fill in the real values:</p>
              <div className="mono-box">{`{
  "sender": "[sms_sender]",
  "body": "[sms_message]",
  "station_code": "LEGACY",
  "secret": "PASTE_YOUR_INGEST_SECRET_HERE"
}`}</div>
              <p style={{ marginTop: 8, fontSize: 13, color: '#6b85a0' }}>
                Note: <code>[sms_sender]</code> and <code>[sms_message]</code> are MacroDroid magic variables.
                Replace <code>PASTE_YOUR_INGEST_SECRET_HERE</code> with the same secret you set in Supabase
                (Edge Functions → Secrets → INGEST_SECRET).
              </p>
            </div>
          </div>

          <div className="step">
            <div className="step-num">6</div>
            <div className="step-body">
              <strong>Test</strong>
              <p>Send any payment to the company Airtel or MTN number. In 1–2 seconds, your TEXOL portal phones should pop up the transaction.</p>
            </div>
          </div>

          <div className="step">
            <div className="step-num">7</div>
            <div className="step-body">
              <strong>Whitelist the phone</strong>
              <p>On each phone that should show popups, open the portal → Admin → Company Phones → Add phone.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr', paddingBottom: 20 }}>
        <div className="card">
          <h3><i className="fas fa-shield-alt" /> Security note</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#4b637c' }}>
            The <code>secret</code> in the JSON body is a shared password. If someone knows your URL <em>and</em> the secret,
            they could inject fake transactions. Keep them private. To rotate: change the secret in Supabase, then update it
            in MacroDroid on each company phone.
          </p>
        </div>
      </div>
    </div>
  )
}