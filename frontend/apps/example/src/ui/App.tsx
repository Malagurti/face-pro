import React, { useState } from "react";
import { ProofOfLife } from "@face-pro/proof-of-life";

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

export function App() {
  const [backendUrl, setBackendUrl] = useState("http://127.0.0.1:8080");
  const [sessionId, setSessionId] = useState("");
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bypassValidation, setBypassValidation] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [standaloneMode, setStandaloneMode] = useState(false);
  const logIdRef = React.useRef(0);

  const addLog = React.useCallback((level: 'info' | 'warn' | 'error', message: string, data?: any) => {
    if (!debugMode) return;
    
    const newLog: LogEntry = {
      id: logIdRef.current++,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      data
    };
    
    setLogs(prevLogs => {
      const updatedLogs = [...prevLogs, newLog];
      // Limpar logs quando passar de 100
      if (updatedLogs.length > 100) {
        return updatedLogs.slice(-50); // Manter apenas os últimos 50
      }
      return updatedLogs;
    });
  }, [debugMode]);

  const clearLogs = React.useCallback(() => {
    setLogs([]);
    logIdRef.current = 0;
  }, []);

  async function createSession() {
    try {
      setBusy(true);
      const res = await fetch(`${backendUrl}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionId(data.session_id);
      setToken(data.token);
      addLog('info', 'Sessão criada com sucesso', { sessionId: data.session_id });
    } catch (e) {
      console.error(e);
      addLog('error', 'Erro ao criar sessão', e);
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
        <label style={{ display: "flex", alignItems: "center", gap: "8px", margin: "10px 0" }}>
          <input 
            type="checkbox" 
            checked={bypassValidation} 
            onChange={(e) => setBypassValidation(e.target.checked)} 
          />
          <span>Modo Bypass (enviar dados brutos para backend processar)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", margin: "10px 0" }}>
          <input 
            type="checkbox" 
            checked={debugMode} 
            onChange={(e) => setDebugMode(e.target.checked)} 
          />
          <span>Debug Mode (mostrar logs detalhados)</span>
        </label>

        <p className="muted" style={{marginTop: 0}}>
          Crie a sessão antes de iniciar para evitar handshake inválido (hello primeiro).<br/>
          📦 <strong>Sistema de Buffer:</strong> Os dados são armazenados localmente durante cada desafio e enviados apenas quando completados com sucesso.
        </p>
        <div className="row">
          <button onClick={createSession} className="ghost" disabled={busy}>{busy ? "Creating..." : "Create session"}</button>
          <button onClick={() => setShow(true)} disabled={!backendUrl || !sessionId || !token}>Start</button>
          <button onClick={() => setShow(false)} className="ghost">Stop</button>
        </div>
        <div className="row" style={{ marginTop: "10px" }}>
          <button 
            onClick={() => {
              setStandaloneMode(true);
              setShow(true);
            }} 
            style={{ 
              backgroundColor: "#3b82f6", 
              color: "white", 
              border: "none", 
              padding: "8px 16px", 
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            🧪 Teste Standalone (sem backend)
          </button>
          {standaloneMode && (
            <button 
              onClick={() => {
                setStandaloneMode(false);
                setShow(false);
              }} 
              className="ghost"
              style={{ marginLeft: "8px" }}
            >
              Parar Teste
            </button>
          )}
        </div>
        <p className="muted" style={{marginTop: "10px", fontSize: "12px"}}>
          💡 <strong>Modo Standalone:</strong> Clique no botão azul para testar apenas a detecção de gestos com MediaPipe, sem precisar de backend. 
          Os desafios aparecerão automaticamente: olhar direita ➡️, esquerda ⬅️, cima ⬆️ e abrir boca 😮.<br/>
          📦 <strong>Sistema de Buffer:</strong> No modo standalone, os dados são coletados e processados localmente com logs detalhados para testes.
        </p>
      </div>

      {show && (
        <div className="card">
          <ProofOfLife 
            backendUrl={standaloneMode ? "" : backendUrl} 
            sessionId={standaloneMode ? "" : sessionId} 
            token={standaloneMode ? "" : token} 
            debug={debugMode} 
            enableLivenessChallenge={standaloneMode || !bypassValidation}
            enableClientHeuristics={!bypassValidation}
            bypassValidation={!standaloneMode && bypassValidation}
            onLog={addLog}
          />
        </div>
      )}

      {debugMode && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <h3>Debug Logs ({logs.length}/100)</h3>
            <button onClick={clearLogs} className="ghost" style={{ padding: "4px 8px", fontSize: "12px" }}>
              Limpar
            </button>
          </div>
          <div style={{
            maxHeight: "300px",
            overflowY: "auto",
            border: "1px solid #ccc",
            borderRadius: "4px",
            padding: "8px",
            backgroundColor: "#f8f9fa",
            fontFamily: "monospace",
            fontSize: "12px"
          }}>
            {logs.length === 0 ? (
              <div style={{ color: "#666", fontStyle: "italic" }}>Nenhum log ainda...</div>
            ) : (
              logs.map(log => (
                <div key={log.id} style={{
                  marginBottom: "4px",
                  padding: "4px",
                  borderLeft: `3px solid ${log.level === 'error' ? '#ef4444' : log.level === 'warn' ? '#f59e0b' : '#3b82f6'}`,
                  backgroundColor: log.level === 'error' ? '#fef2f2' : log.level === 'warn' ? '#fffbeb' : '#eff6ff'
                }}>
                  <div style={{ fontWeight: "bold", color: log.level === 'error' ? '#dc2626' : log.level === 'warn' ? '#d97706' : '#2563eb' }}>
                    [{log.timestamp}] {log.level.toUpperCase()}
                  </div>
                  <div style={{ marginTop: "2px" }}>
                    {log.message}
                  </div>
                  {log.data && (
                    <div style={{ marginTop: "2px", fontSize: "11px", color: "#666" }}>
                      {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}


