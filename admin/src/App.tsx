import { useState, useEffect } from 'react'
import './App.css'

interface Stats {
  total: number
  active: number
  expired: number
  revoked: number
  validationsToday: number
}

interface License {
  id: number
  key: string
  product_id: string
  customer_id: string
  customer_name: string | null
  license_type: string
  issued_at: number
  expires_at: number | null
  max_users: number
  features: string
  revoked: number
}

const API = '/api'

function useAdminToken() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('adminToken'))
  const login = (t: string) => { localStorage.setItem('adminToken', t); setToken(t) }
  const logout = () => { localStorage.removeItem('adminToken'); setToken(null) }
  return { token, login, logout }
}

export default function App() {
  const { token, login, logout } = useAdminToken()
  const [tab, setTab] = useState<'dashboard' | 'licenses' | 'generate'>('dashboard')
  const [stats, setStats] = useState<Stats | null>(null)
  const [licenses, setLicenses] = useState<License[]>([])
  const [loginError, setLoginError] = useState('')

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  useEffect(() => {
    if (!token) return
    fetch(`${API}/admin/stats`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setStats)
      .catch(() => logout())
  }, [token])

  useEffect(() => {
    if (!token || tab !== 'licenses') return
    fetch(`${API}/admin/licenses`, { headers: authHeaders })
      .then(r => r.json())
      .then(d => setLicenses(d.licenses ?? []))
  }, [token, tab])

  if (!token) return <LoginForm onLogin={login} error={loginError} setError={setLoginError} />

  return (
    <div className="app">
      <header>
        <h1>🔑 darWIN License Portal</h1>
        <nav>
          <button onClick={() => setTab('dashboard')} className={tab === 'dashboard' ? 'active' : ''}>Dashboard</button>
          <button onClick={() => setTab('licenses')} className={tab === 'licenses' ? 'active' : ''}>Licenze</button>
          <button onClick={() => setTab('generate')} className={tab === 'generate' ? 'active' : ''}>Genera</button>
          <button onClick={logout} className="logout">Esci</button>
        </nav>
      </header>
      <main>
        {tab === 'dashboard' && <Dashboard stats={stats} />}
        {tab === 'licenses' && <LicenseList licenses={licenses} token={token} onRevoke={() => { setTab('dashboard'); setTimeout(() => setTab('licenses'), 100) }} />}
        {tab === 'generate' && <GenerateForm token={token} onGenerated={() => setTab('licenses')} />}
      </main>
    </div>
  )
}

function LoginForm({ onLogin, error, setError }: { onLogin: (t: string) => void; error: string; setError: (e: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (res.ok) {
      const { token } = await res.json()
      onLogin(token)
    } else {
      setError('Credenziali non valide')
    }
  }

  return (
    <div className="login-form">
      <h1>🔑 darWIN License Portal</h1>
      <form onSubmit={handleSubmit}>
        <label>Username<input value={username} onChange={e => setUsername(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Accedi</button>
      </form>
    </div>
  )
}

function Dashboard({ stats }: { stats: Stats | null }) {
  if (!stats) return <p>Caricamento...</p>
  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      <div className="stats-grid">
        <StatCard label="Licenze totali" value={stats.total} color="#4f8ef7" />
        <StatCard label="Attive" value={stats.active} color="#4caf50" />
        <StatCard label="Scadute" value={stats.expired} color="#ff9800" />
        <StatCard label="Revocate" value={stats.revoked} color="#f44336" />
        <StatCard label="Validazioni oggi" value={stats.validationsToday} color="#9c27b0" />
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="stat-card" style={{ borderLeftColor: color }}>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function LicenseList({ licenses, token, onRevoke }: { licenses: License[]; token: string; onRevoke: () => void }) {
  const revoke = async (key: string) => {
    if (!confirm('Revocare questa licenza?')) return
    const reason = prompt('Motivo della revoca (opzionale):') || undefined
    await fetch(`/api/admin/licenses/${encodeURIComponent(key)}/revoke`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    onRevoke()
  }

  return (
    <div>
      <h2>Licenze ({licenses.length})</h2>
      <table className="license-table">
        <thead>
          <tr><th>Prodotto</th><th>Cliente</th><th>Tipo</th><th>Scadenza</th><th>Utenti</th><th>Stato</th><th></th></tr>
        </thead>
        <tbody>
          {licenses.map(l => (
            <tr key={l.id} className={l.revoked ? 'revoked' : ''}>
              <td>{l.product_id}</td>
              <td>{l.customer_name || l.customer_id}</td>
              <td><span className={`badge badge-${l.license_type}`}>{l.license_type}</span></td>
              <td>{l.expires_at ? new Date(l.expires_at * 1000).toLocaleDateString('it-IT') : '∞ perpetua'}</td>
              <td>{l.max_users}</td>
              <td>{l.revoked ? '🔴 Revocata' : '🟢 Attiva'}</td>
              <td>{!l.revoked && <button onClick={() => revoke(l.key)} className="btn-danger">Revoca</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GenerateForm({ token, onGenerated }: { token: string; onGenerated: () => void }) {
  const [form, setForm] = useState({
    productId: 'PEC2PDF',
    customerId: '',
    customerName: '',
    licenseType: 'professional',
    expiresInDays: 365,
    maxUsers: 1,
    features: 'convert,protocol,update',
    notes: '',
  })
  const [result, setResult] = useState<{ key: string } | null>(null)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/admin/licenses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        expiresInDays: Number(form.expiresInDays) || undefined,
        maxUsers: Number(form.maxUsers),
        features: form.features.split(',').map(s => s.trim()).filter(Boolean),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setResult(data)
    } else {
      const err = await res.json()
      setError(JSON.stringify(err.message || err))
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="generate-form">
      <h2>Genera nuova licenza</h2>
      {result ? (
        <div className="generated-key">
          <p>✅ Licenza generata per <strong>{form.customerName || form.customerId}</strong></p>
          <textarea readOnly value={result.key} rows={3} />
          <button onClick={() => { navigator.clipboard.writeText(result.key) }}>📋 Copia chiave</button>
          <button onClick={() => { setResult(null); onGenerated() }}>Vai all'elenco</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>Prodotto<select value={form.productId} onChange={set('productId')}>
            <option value="PEC2PDF">pec-to-pdf-converter (PEC2PDF)</option>
          </select></label>
          <label>ID Cliente *<input value={form.customerId} onChange={set('customerId')} required placeholder="ACME_001" /></label>
          <label>Nome Cliente<input value={form.customerName} onChange={set('customerName')} placeholder="ACME srl" /></label>
          <label>Tipo licenza<select value={form.licenseType} onChange={set('licenseType')}>
            <option value="trial">Trial</option>
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select></label>
          <label>Durata (giorni, lascia 0 per perpetua)<input type="number" value={form.expiresInDays} onChange={set('expiresInDays')} min={0} /></label>
          <label>Utenti max<input type="number" value={form.maxUsers} onChange={set('maxUsers')} min={1} /></label>
          <label>Feature (separate da virgola)<input value={form.features} onChange={set('features')} /></label>
          <label>Note<textarea value={form.notes} onChange={set('notes')} /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit">🔑 Genera licenza</button>
        </form>
      )}
    </div>
  )
}
