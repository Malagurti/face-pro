import React, { useState } from "react";
import { ProofOfLife } from "@face-pro/proof-of-life";

export function App() {
  const [backendUrl, setBackendUrl] = useState("http://127.0.0.1:8080");
  const [sessionId, setSessionId] = useState("");
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createSession() {
    try {
      setBusy(true);
      const res = await fetch(`${backendUrl}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionId(data.session_id);
      setToken(data.token);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1>Face Pro</h1>
      <p className="muted">Proof of life example</p>

      <div className="card">
        <label>Backend URL</label>
        <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
        <label>Session ID</label>
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
        <label>Token</label>
        <input value={token} onChange={(e) => setToken(e.target.value)} />
        <p className="muted" style={{marginTop: 0}}>Crie a sessão antes de iniciar para evitar handshake inválido (hello primeiro).</p>
        <div className="row">
          <button onClick={createSession} className="ghost" disabled={busy}>{busy ? "Creating..." : "Create session"}</button>
          <button onClick={() => setShow(true)} disabled={!backendUrl || !sessionId || !token}>Start</button>
          <button onClick={() => setShow(false)} className="ghost">Stop</button>
        </div>
      </div>

      {show && (
        <div className="card">
          <ProofOfLife 
            backendUrl={backendUrl} 
            sessionId={sessionId} 
            token={token} 
            debug 
            enablePositionGuide={true}
            enableClientHeuristics={true}
          />
        </div>
      )}
    </div>
  );
}


