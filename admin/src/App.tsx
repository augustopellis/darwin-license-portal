import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
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
  license_type: LicenseType
  application_type: ApplicationType
  binding_mode: BindingMode
  issued_at: number
  expires_at: number | null
  max_users: number
  max_activations: number
  features: string
  revoked: number
  revoked_at?: number | null
  revoke_reason?: string | null
  notes?: string | null
  created_at?: number
}

interface Product {
  id: string
  name: string
  description: string
  applicationType: ApplicationType
  defaultBindingMode: BindingMode
  defaultMaxActivations: number
  defaultFeatures: string[]
  active: boolean
  createdAt?: string
  totalLicenses?: number
  activeLicenses?: number
}

type LicenseType = 'trial' | 'starter' | 'professional' | 'enterprise'
type ApplicationType = 'desktop' | 'hybrid' | 'web'
type BindingMode = 'none' | 'workstation' | 'server' | 'tenant'
type Tab = 'dashboard' | 'licenses' | 'generate' | 'products'
type StatusFilter = 'all' | 'active' | 'expiring' | 'expired' | 'revoked'

interface EditLicenseForm {
  customerId: string
  customerName: string
  licenseType: LicenseType
  maxUsers: number
  maxActivations: number
  features: string
  notes: string
}

const API = '/api'

const LICENSE_TYPE_OPTIONS: Array<{
  id: LicenseType
  label: string
  description: string
  defaultDays: number
  defaultUsers: number
  defaultFeatures: string[]
}> = [
  {
    id: 'trial',
    label: 'Trial',
    description: 'Periodo breve per demo, test o proof of concept.',
    defaultDays: 30,
    defaultUsers: 1,
    defaultFeatures: ['convert'],
  },
  {
    id: 'starter',
    label: 'Starter',
    description: 'Licenza essenziale per piccoli clienti e singola postazione.',
    defaultDays: 365,
    defaultUsers: 1,
    defaultFeatures: ['convert'],
  },
  {
    id: 'professional',
    label: 'Professional',
    description: 'Piano standard con funzioni operative avanzate.',
    defaultDays: 365,
    defaultUsers: 5,
    defaultFeatures: ['convert', 'protocol', 'update'],
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    description: 'Contratti estesi con piu utenti, integrazioni e supporto dedicato.',
    defaultDays: 0,
    defaultUsers: 25,
    defaultFeatures: ['convert', 'protocol', 'update', 'multi_user', 'priority_support'],
  },
]

const FEATURE_LIBRARY = [
  { key: 'convert', label: 'Conversione', description: 'Abilita la funzione principale di conversione.' },
  { key: 'protocol', label: 'Protocollo', description: 'Abilita bridge, protocollazione o workflow documentali.' },
  { key: 'update', label: 'Update', description: 'Permette aggiornamenti o update channel gestiti.' },
  { key: 'multi_user', label: 'Multi utente', description: 'Consente uso su piu postazioni o utenti.' },
  { key: 'priority_support', label: 'Supporto prioritario', description: 'Segnala clienti con SLA o assistenza dedicata.' },
]

const APPLICATION_TYPE_OPTIONS: Array<{ id: ApplicationType; label: string; description: string }> = [
  { id: 'desktop', label: 'Desktop Windows', description: 'Eseguibile installato su una postazione.' },
  { id: 'hybrid', label: 'Ibrido server', description: 'Applicazione desktop/server, per esempio Delphi + uniGUI.' },
  { id: 'web', label: 'Web puro', description: 'Applicazione web o TypeScript distribuita per tenant o istanza.' },
]

const BINDING_MODE_OPTIONS: Array<{ id: BindingMode; label: string; description: string }> = [
  { id: 'workstation', label: 'Postazione', description: 'Richiede fingerprint macchina: ideale per eseguibili desktop.' },
  { id: 'server', label: 'Server', description: 'Lega la licenza al server o alla VM che ospita il prodotto.' },
  { id: 'tenant', label: 'Tenant', description: 'Lega la licenza a tenant, dominio o deployment web.' },
  { id: 'none', label: 'Nessuno', description: 'Non richiede attivazione. Da usare solo per casi speciali.' },
]

function useAdminToken() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('adminToken'))
  const login = (value: string) => {
    localStorage.setItem('adminToken', value)
    setToken(value)
  }
  const logout = () => {
    localStorage.removeItem('adminToken')
    setToken(null)
  }
  return { token, login, logout }
}

export default function App() {
  const { token, login, logout } = useAdminToken()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [stats, setStats] = useState<Stats | null>(null)
  const [licenses, setLicenses] = useState<License[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [appError, setAppError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [refreshSeed, setRefreshSeed] = useState(0)

  const refresh = () => setRefreshSeed(seed => seed + 1)

  useEffect(() => {
    if (!token) return

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setAppError('')
      try {
        const [statsData, licenseData, productData] = await Promise.all([
          requestJson<Stats>('/admin/stats', token),
          requestJson<{ licenses: License[] }>('/admin/licenses', token),
          requestJson<{ products: Product[] }>('/admin/products', token),
        ])

        if (cancelled) return
        setStats(statsData)
        setLicenses(licenseData.licenses ?? [])
        setProducts(productData.products ?? [])
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          logout()
          return
        }
        setAppError('Impossibile aggiornare i dati del portale.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [token, refreshSeed])

  if (!token) return <LoginForm onLogin={login} error={loginError} setError={setLoginError} />

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">dW</span>
          <div>
            <h1>darWIN License Portal</h1>
            <span>Produzione</span>
          </div>
        </div>
        <nav aria-label="Navigazione admin">
          <NavButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</NavButton>
          <NavButton active={tab === 'licenses'} onClick={() => setTab('licenses')}>Licenze</NavButton>
          <NavButton active={tab === 'generate'} onClick={() => setTab('generate')}>Genera</NavButton>
          <NavButton active={tab === 'products'} onClick={() => setTab('products')}>Prodotti</NavButton>
          <button type="button" onClick={logout} className="logout">Esci</button>
        </nav>
      </header>

      <main>
        {appError && <div className="alert error-alert">{appError}</div>}
        {loading && <div className="loading-line" />}

        {tab === 'dashboard' && (
          <Dashboard
            stats={stats}
            licenses={licenses}
            products={products}
            onNavigate={setTab}
          />
        )}

        {tab === 'licenses' && (
          <LicenseList
            licenses={licenses}
            products={products}
            token={token}
            onChanged={refresh}
          />
        )}

        {tab === 'generate' && (
          <GenerateForm
            token={token}
            products={products}
            onGenerated={() => {
              refresh()
              setTab('licenses')
            }}
          />
        )}

        {tab === 'products' && (
          <ProductManager
            token={token}
            products={products}
            licenses={licenses}
            onChanged={refresh}
          />
        )}
      </main>
    </div>
  )
}

function LoginForm({ onLogin, error, setError }: { onLogin: (t: string) => void; error: string; setError: (e: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')

    try {
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
    } catch {
      setError('Portale non raggiungibile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-form">
        <span className="brand-mark">dW</span>
        <h1>darWIN License Portal</h1>
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Accesso in corso' : 'Accedi'}</button>
        </form>
      </section>
    </main>
  )
}

function Dashboard({ stats, licenses, products, onNavigate }: {
  stats: Stats | null
  licenses: License[]
  products: Product[]
  onNavigate: (tab: Tab) => void
}) {
  const activeProducts = products.filter(product => product.active)
  const totalSeats = licenses.filter(isActiveLicense).reduce((sum, license) => sum + Number(license.max_users || 0), 0)
  const expiringSoon = licenses.filter(isExpiringSoon)
  const recentLicenses = [...licenses].sort((a, b) => (b.created_at ?? b.issued_at) - (a.created_at ?? a.issued_at)).slice(0, 5)
  const activeRate = stats && stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0

  if (!stats) {
    return <EmptyState title="Caricamento dashboard" text="Recupero metriche, prodotti e licenze." />
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Panoramica operativa</h2>
        </div>
        <div className="heading-actions">
          <button type="button" className="secondary-button" onClick={() => onNavigate('products')}>Prodotti</button>
          <button type="button" className="primary-button" onClick={() => onNavigate('generate')}>Nuova licenza</button>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Licenze totali" value={stats.total} hint={`${activeRate}% attive`} tone="blue" />
        <StatCard label="Attive" value={stats.active} hint={`${totalSeats} utenti coperti`} tone="green" />
        <StatCard label="In scadenza" value={expiringSoon.length} hint="entro 30 giorni" tone="amber" />
        <StatCard label="Revocate" value={stats.revoked} hint={`${stats.expired} scadute`} tone="red" />
        <StatCard label="Validazioni oggi" value={stats.validationsToday} hint="dal log server" tone="purple" />
        <StatCard label="Prodotti attivi" value={activeProducts.length} hint={`${products.length} in catalogo`} tone="slate" />
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-heading">
            <h3>Prodotti</h3>
            <button type="button" className="link-button" onClick={() => onNavigate('products')}>Gestisci</button>
          </div>
          <ProductMix products={products} licenses={licenses} />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h3>Scadenze vicine</h3>
            <button type="button" className="link-button" onClick={() => onNavigate('licenses')}>Vedi licenze</button>
          </div>
          <ExpiringList licenses={expiringSoon} />
        </div>

        <div className="panel wide">
          <div className="panel-heading">
            <h3>Ultime licenze</h3>
            <button type="button" className="link-button" onClick={() => onNavigate('licenses')}>Apri elenco</button>
          </div>
          <RecentLicenses licenses={recentLicenses} />
        </div>
      </section>
    </div>
  )
}

function LicenseList({ licenses, products, token, onChanged }: {
  licenses: License[]
  products: Product[]
  token: string
  onChanged: () => void
}) {
  const [query, setQuery] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | LicenseType>('all')
  const [selectedId, setSelectedId] = useState<number | null>(licenses[0]?.id ?? null)
  const [editingLicense, setEditingLicense] = useState<License | null>(null)

  const filteredLicenses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return licenses.filter(license => {
      const haystack = [
        license.key,
        license.product_id,
        license.customer_id,
        license.customer_name ?? '',
        license.license_type,
      ].join(' ').toLowerCase()

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
      if (productFilter !== 'all' && license.product_id !== productFilter) return false
      if (typeFilter !== 'all' && license.license_type !== typeFilter) return false
      if (statusFilter === 'active' && !isActiveLicense(license)) return false
      if (statusFilter === 'expiring' && !isExpiringSoon(license)) return false
      if (statusFilter === 'expired' && !isExpired(license)) return false
      if (statusFilter === 'revoked' && !license.revoked) return false
      return true
    })
  }, [licenses, productFilter, query, statusFilter, typeFilter])

  const selected = filteredLicenses.find(license => license.id === selectedId) ?? filteredLicenses[0] ?? null

  const revoke = async (key: string) => {
    if (!confirm('Revocare questa licenza?')) return
    const reason = prompt('Motivo della revoca (opzionale):') || undefined
    await requestJson(`/admin/licenses/${encodeURIComponent(key)}/revoke`, token, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    })
    onChanged()
  }

  const deleteLicense = async (key: string) => {
    if (!confirm('Eliminare definitivamente questa licenza? L\'operazione non è reversibile.')) return
    await requestJson(`/admin/licenses/${encodeURIComponent(key)}`, token, { method: 'DELETE' })
    if (selected?.key === key) setSelectedId(null)
    onChanged()
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Licenze</p>
          <h2>Archivio licenze</h2>
        </div>
        <span className="count-pill">{filteredLicenses.length} risultati</span>
      </section>

      <section className="toolbar">
        <label className="search-field">
          Cerca
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="cliente, prodotto, chiave" />
        </label>
        <label>
          Prodotto
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)}>
            <option value="all">Tutti</option>
            {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <label>
          Stato
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">Tutti</option>
            <option value="active">Attive</option>
            <option value="expiring">In scadenza</option>
            <option value="expired">Scadute</option>
            <option value="revoked">Revocate</option>
          </select>
        </label>
        <label>
          Tipo
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'all' | LicenseType)}>
            <option value="all">Tutti</option>
            {LICENSE_TYPE_OPTIONS.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
        </label>
      </section>

      <section className="content-grid">
        <div className="table-shell">
          {filteredLicenses.length === 0 ? (
            <EmptyState title="Nessuna licenza trovata" text="Modifica i filtri o genera una nuova licenza." />
          ) : (
            <table className="license-table">
              <thead>
                <tr>
                  <th>Prodotto</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Vincolo</th>
                  <th>Scadenza</th>
                  <th>Utenti</th>
                  <th>Stato</th>
                  <th>Azione</th>
                </tr>
              </thead>
              <tbody>
                {filteredLicenses.map(license => (
                  <tr key={license.id} className={selected?.id === license.id ? 'selected' : ''}>
                    <td>
                      <strong>{license.product_id}</strong>
                      <span>{productName(products, license.product_id)}</span>
                    </td>
                    <td>
                      <strong>{license.customer_name || license.customer_id}</strong>
                      <span>{license.customer_id}</span>
                    </td>
                    <td><TypeBadge type={license.license_type} /></td>
                    <td>
                      <strong>{bindingModeLabel(license.binding_mode)}</strong>
                      <span>{applicationTypeLabel(license.application_type)} - {license.max_activations} att.</span>
                    </td>
                    <td>{formatExpiry(license)}</td>
                    <td>{license.max_users}</td>
                    <td><StatusBadge license={license} /></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="secondary-button small" onClick={() => setSelectedId(license.id)}>Dettagli</button>
                        <button type="button" className="secondary-button small" onClick={() => setEditingLicense(license)}>Modifica</button>
                        {!license.revoked && <button type="button" className="danger-button small" onClick={() => revoke(license.key)}>Revoca</button>}
                        <button type="button" className="danger-button small" onClick={() => deleteLicense(license.key)}>Elimina</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <LicenseDetails license={selected} products={products} onCopy={copyText} onRevoke={revoke} onEdit={setEditingLicense} onDelete={deleteLicense} />
      </section>

      {editingLicense && (
        <EditLicenseModal
          license={editingLicense}
          token={token}
          onClose={() => setEditingLicense(null)}
          onSaved={() => { setEditingLicense(null); onChanged() }}
        />
      )}
    </div>
  )
}

function GenerateForm({ token, products, onGenerated }: { token: string; products: Product[]; onGenerated: () => void }) {
  const activeProducts = products.filter(product => product.active)
  const firstProduct = activeProducts[0]
  const [form, setForm] = useState({
    productId: firstProduct?.id ?? 'PEC2PDF',
    customerId: '',
    customerName: '',
    licenseType: 'professional' as LicenseType,
    applicationType: (firstProduct?.applicationType ?? 'desktop') as ApplicationType,
    bindingMode: (firstProduct?.defaultBindingMode ?? 'workstation') as BindingMode,
    expiresInDays: 365,
    maxUsers: 5,
    maxActivations: firstProduct?.defaultMaxActivations ?? 1,
    features: featureText(firstProduct?.defaultFeatures ?? ['convert', 'protocol', 'update']),
    notes: '',
  })
  const [result, setResult] = useState<{ key: string } | null>(null)
  const [error, setError] = useState('')
  const selectedProduct = products.find(product => product.id === form.productId)
  const selectedType = LICENSE_TYPE_OPTIONS.find(type => type.id === form.licenseType) ?? LICENSE_TYPE_OPTIONS[2]
  const selectedApplicationType = APPLICATION_TYPE_OPTIONS.find(type => type.id === form.applicationType) ?? APPLICATION_TYPE_OPTIONS[0]
  const selectedBindingMode = BINDING_MODE_OPTIONS.find(mode => mode.id === form.bindingMode) ?? BINDING_MODE_OPTIONS[0]

  useEffect(() => {
    if (!firstProduct || products.some(product => product.id === form.productId)) return
    setForm(current => ({
      ...current,
      productId: firstProduct.id,
      applicationType: firstProduct.applicationType,
      bindingMode: firstProduct.defaultBindingMode,
      maxActivations: firstProduct.defaultMaxActivations,
      features: featureText(firstProduct.defaultFeatures),
    }))
  }, [firstProduct?.id, products.length])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)

    try {
      const data = await requestJson<{ key: string }>('/admin/licenses', token, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          expiresInDays: Number(form.expiresInDays) || undefined,
          maxUsers: Number(form.maxUsers),
          maxActivations: Number(form.maxActivations),
          features: parseFeatureInput(form.features),
        }),
      })
      setResult(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Generazione non riuscita'
      setError(message)
    }
  }

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value
    setForm(current => ({ ...current, [key]: value }))
  }

  const setProduct = (e: ChangeEvent<HTMLSelectElement>) => {
    const product = products.find(item => item.id === e.target.value)
    setForm(current => ({
      ...current,
      productId: e.target.value,
      applicationType: product?.applicationType ?? current.applicationType,
      bindingMode: product?.defaultBindingMode ?? current.bindingMode,
      maxActivations: product?.defaultMaxActivations ?? current.maxActivations,
      features: product ? featureText(product.defaultFeatures) : current.features,
    }))
  }

  const setApplicationType = (e: ChangeEvent<HTMLSelectElement>) => {
    const applicationType = e.target.value as ApplicationType
    setForm(current => ({
      ...current,
      applicationType,
      bindingMode: defaultBindingModeForApplicationType(applicationType),
    }))
  }

  const setLicenseType = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextType = LICENSE_TYPE_OPTIONS.find(type => type.id === e.target.value) ?? selectedType
    const productFeatures = selectedProduct?.defaultFeatures ?? []
    setForm(current => ({
      ...current,
      licenseType: nextType.id,
      expiresInDays: nextType.defaultDays,
      maxUsers: nextType.defaultUsers,
      features: featureText([...productFeatures, ...nextType.defaultFeatures]),
    }))
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Genera</p>
          <h2>Nuova licenza</h2>
        </div>
      </section>

      {result ? (
        <section className="generated-key">
          <h3>Licenza pronta</h3>
          <p>Cliente: <strong>{form.customerName || form.customerId}</strong></p>
          <textarea readOnly value={result.key} rows={4} />
          <div className="button-row">
            <button type="button" className="primary-button" onClick={() => copyText(result.key)}>Copia chiave</button>
            <button type="button" className="secondary-button" onClick={() => { setResult(null); onGenerated() }}>Apri elenco</button>
          </div>
        </section>
      ) : (
        <form className="form-grid" onSubmit={handleSubmit}>
          <section className="form-section">
            <h3>Cliente e prodotto</h3>
            <label>
              Prodotto
              <select value={form.productId} onChange={setProduct} disabled={activeProducts.length === 0}>
                {activeProducts.map(product => <option key={product.id} value={product.id}>{product.name} ({product.id})</option>)}
              </select>
              <span>{selectedProduct?.description || 'Aggiungi un prodotto attivo dal catalogo prima di generare licenze.'}</span>
            </label>
            <label>
              ID cliente
              <input value={form.customerId} onChange={set('customerId')} required placeholder="ACME_001" />
              <span>Identificativo stabile usato per ricerca, fatturazione e supporto.</span>
            </label>
            <label>
              Nome cliente
              <input value={form.customerName} onChange={set('customerName')} placeholder="ACME srl" />
              <span>Nome leggibile mostrato nelle liste e nei dettagli licenza.</span>
            </label>
          </section>

          <section className="form-section">
            <h3>Piano e limiti</h3>
            <label>
              Tipo licenza
              <select value={form.licenseType} onChange={setLicenseType}>
                {LICENSE_TYPE_OPTIONS.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
              <span>{selectedType.description}</span>
            </label>
            <label>
              Durata giorni
              <input type="number" value={form.expiresInDays} onChange={set('expiresInDays')} min={0} />
              <span>Usa 0 per licenza perpetua; per trial e rinnovi usa una scadenza esplicita.</span>
            </label>
            <label>
              Utenti max
              <input type="number" value={form.maxUsers} onChange={set('maxUsers')} min={1} />
              <span>Numero massimo di utenti coperti dal contratto.</span>
            </label>
          </section>

          <section className="form-section">
            <h3>Attivazione</h3>
            <label>
              Natura app
              <select value={form.applicationType} onChange={setApplicationType}>
                {APPLICATION_TYPE_OPTIONS.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
              <span>{selectedApplicationType.description}</span>
            </label>
            <label>
              Vincolo
              <select value={form.bindingMode} onChange={set('bindingMode')}>
                {BINDING_MODE_OPTIONS.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
              <span>{selectedBindingMode.description}</span>
            </label>
            <label>
              Attivazioni max
              <input type="number" value={form.maxActivations} onChange={set('maxActivations')} min={1} />
              <span>Numero di postazioni, server o tenant che possono agganciare questa licenza.</span>
            </label>
          </section>

          <section className="form-section wide">
            <h3>Feature e note</h3>
            <FeaturePicker value={form.features} onChange={features => setForm(current => ({ ...current, features }))} />
            <label>
              Note interne
              <textarea value={form.notes} onChange={set('notes')} rows={4} placeholder="Riferimento ordine, commerciale, condizioni speciali" />
              <span>Le note restano nel portale admin e non entrano nella chiave licenza.</span>
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary-button" disabled={activeProducts.length === 0}>Genera licenza</button>
          </section>
        </form>
      )}
    </div>
  )
}

function ProductManager({ token, products, licenses, onChanged }: {
  token: string
  products: Product[]
  licenses: License[]
  onChanged: () => void
}) {
  const emptyProduct = {
    id: '',
    name: '',
    description: '',
    applicationType: 'desktop' as ApplicationType,
    defaultBindingMode: 'workstation' as BindingMode,
    defaultMaxActivations: 1,
    defaultFeatures: 'convert',
    active: true,
  }
  const [form, setForm] = useState(emptyProduct)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const selectedApplicationType = APPLICATION_TYPE_OPTIONS.find(type => type.id === form.applicationType) ?? APPLICATION_TYPE_OPTIONS[0]
  const selectedBindingMode = BINDING_MODE_OPTIONS.find(mode => mode.id === form.defaultBindingMode) ?? BINDING_MODE_OPTIONS[0]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const payload = {
      id: normalizeProductId(form.id),
      name: form.name.trim(),
      description: form.description.trim(),
      applicationType: form.applicationType,
      defaultBindingMode: form.defaultBindingMode,
      defaultMaxActivations: Number(form.defaultMaxActivations),
      defaultFeatures: parseFeatureInput(form.defaultFeatures),
      active: form.active,
    }

    try {
      if (editingId) {
        await requestJson(`/admin/products/${encodeURIComponent(editingId)}`, token, {
          method: 'PUT',
          body: JSON.stringify({
            name: payload.name,
            description: payload.description,
            applicationType: payload.applicationType,
            defaultBindingMode: payload.defaultBindingMode,
            defaultMaxActivations: payload.defaultMaxActivations,
            defaultFeatures: payload.defaultFeatures,
            active: payload.active,
          }),
        })
      } else {
        await requestJson('/admin/products', token, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      setForm(emptyProduct)
      setEditingId(null)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio prodotto non riuscito')
    }
  }

  const edit = (product: Product) => {
    setEditingId(product.id)
    setForm({
      id: product.id,
      name: product.name,
      description: product.description,
      applicationType: product.applicationType,
      defaultBindingMode: product.defaultBindingMode,
      defaultMaxActivations: product.defaultMaxActivations,
      defaultFeatures: featureText(product.defaultFeatures),
      active: product.active,
    })
  }

  const setProductApplicationType = (e: ChangeEvent<HTMLSelectElement>) => {
    const applicationType = e.target.value as ApplicationType
    setForm(current => ({
      ...current,
      applicationType,
      defaultBindingMode: defaultBindingModeForApplicationType(applicationType),
    }))
  }

  const archive = async (product: Product) => {
    if (!confirm(`Archiviare ${product.name}? Le licenze esistenti restano nello storico.`)) return
    await requestJson(`/admin/products/${encodeURIComponent(product.id)}`, token, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Prodotti</p>
          <h2>Catalogo prodotti</h2>
        </div>
        <span className="count-pill">{products.filter(product => product.active).length} attivi</span>
      </section>

      <section className="product-layout">
        <form className="form-section product-form" onSubmit={submit}>
          <h3>{editingId ? 'Modifica prodotto' : 'Nuovo prodotto'}</h3>
          <label>
            ID prodotto
            <input
              value={form.id}
              onChange={e => setForm(current => ({ ...current, id: normalizeProductId(e.target.value) }))}
              required
              disabled={Boolean(editingId)}
              placeholder="PEC2PDF"
            />
            <span>Codice stabile usato dalle app client nel campo `productId`.</span>
          </label>
          <label>
            Nome
            <input value={form.name} onChange={e => setForm(current => ({ ...current, name: e.target.value }))} required placeholder="pec-to-pdf-converter" />
            <span>Nome leggibile per pannello admin, ricerca e report.</span>
          </label>
          <label>
            Descrizione
            <textarea value={form.description} onChange={e => setForm(current => ({ ...current, description: e.target.value }))} rows={4} />
            <span>Breve nota operativa per distinguere prodotto, modulo o verticale.</span>
          </label>
          <label>
            Natura app
            <select value={form.applicationType} onChange={setProductApplicationType}>
              {APPLICATION_TYPE_OPTIONS.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
            <span>{selectedApplicationType.description}</span>
          </label>
          <label>
            Vincolo default
            <select value={form.defaultBindingMode} onChange={e => setForm(current => ({ ...current, defaultBindingMode: e.target.value as BindingMode }))}>
              {BINDING_MODE_OPTIONS.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
            <span>{selectedBindingMode.description}</span>
          </label>
          <label>
            Attivazioni default
            <input
              type="number"
              value={form.defaultMaxActivations}
              onChange={e => setForm(current => ({ ...current, defaultMaxActivations: Number(e.target.value) || 1 }))}
              min={1}
            />
            <span>Default usato quando generi una nuova licenza per questo prodotto.</span>
          </label>
          <FeaturePicker value={form.defaultFeatures} onChange={features => setForm(current => ({ ...current, defaultFeatures: features }))} />
          <label className="checkbox-field">
            <input type="checkbox" checked={form.active} onChange={e => setForm(current => ({ ...current, active: e.target.checked }))} />
            Prodotto attivo
          </label>
          {error && <p className="error">{error}</p>}
          <div className="button-row">
            <button type="submit" className="primary-button">{editingId ? 'Salva modifiche' : 'Aggiungi prodotto'}</button>
            {editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setForm(emptyProduct) }}>Annulla</button>}
          </div>
        </form>

        <div className="product-list">
          {products.map(product => {
            const productLicenses = licenses.filter(license => license.product_id === product.id)
            return (
              <article className="product-card" key={product.id}>
                <div className="product-card-head">
                  <div>
                    <h3>{product.name}</h3>
                    <span>{product.id}</span>
                  </div>
                  <StatusPill active={product.active} />
                </div>
                <p>{product.description || 'Nessuna descrizione.'}</p>
                <div className="mini-metrics">
                  <span>{productLicenses.length} licenze</span>
                  <span>{productLicenses.filter(isActiveLicense).length} attive</span>
                  <span>{bindingModeLabel(product.defaultBindingMode)}</span>
                </div>
                <div className="feature-tags">
                  <span>{applicationTypeLabel(product.applicationType)}</span>
                  <span>{product.defaultMaxActivations} att.</span>
                </div>
                <FeatureTags features={product.defaultFeatures} />
                <div className="button-row">
                  <button type="button" className="secondary-button small" onClick={() => edit(product)}>Modifica</button>
                  {product.active && <button type="button" className="danger-button small" onClick={() => archive(product)}>Archivia</button>}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function FeaturePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = parseFeatureInput(value)

  const toggle = (feature: string) => {
    const next = selected.includes(feature)
      ? selected.filter(item => item !== feature)
      : [...selected, feature]
    onChange(featureText(next))
  }

  return (
    <div className="feature-picker">
      <label>
        Feature
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="convert,protocol,update" />
        <span>Lista separata da virgole. Le app client abilitano funzioni in base a questi codici.</span>
      </label>
      <div className="feature-library" aria-label="Feature disponibili">
        {FEATURE_LIBRARY.map(feature => (
          <button
            type="button"
            key={feature.key}
            className={selected.includes(feature.key) ? 'feature-chip selected' : 'feature-chip'}
            onClick={() => toggle(feature.key)}
            title={feature.description}
          >
            {feature.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function LicenseDetails({ license, products, onCopy, onRevoke, onEdit, onDelete }: {
  license: License | null
  products: Product[]
  onCopy: (value: string) => void
  onRevoke: (key: string) => void
  onEdit: (license: License) => void
  onDelete: (key: string) => void
}) {
  if (!license) {
    return <aside className="detail-panel"><EmptyState title="Nessun dettaglio" text="Seleziona una licenza dalla tabella." /></aside>
  }

  return (
    <aside className="detail-panel">
      <div className="panel-heading">
        <h3>Dettaglio licenza</h3>
        <StatusBadge license={license} />
      </div>
      <dl className="detail-list">
        <div><dt>Cliente</dt><dd>{license.customer_name || license.customer_id}</dd></div>
        <div><dt>Prodotto</dt><dd>{productName(products, license.product_id)} ({license.product_id})</dd></div>
        <div><dt>Tipo</dt><dd><TypeBadge type={license.license_type} /></dd></div>
        <div><dt>App</dt><dd>{applicationTypeLabel(license.application_type)}</dd></div>
        <div><dt>Vincolo</dt><dd>{bindingModeLabel(license.binding_mode)}</dd></div>
        <div><dt>Attivazioni</dt><dd>{license.max_activations}</dd></div>
        <div><dt>Scadenza</dt><dd>{formatExpiry(license)}</dd></div>
        <div><dt>Utenti</dt><dd>{license.max_users}</dd></div>
      </dl>
      <FeatureTags features={parseLicenseFeatures(license.features)} />
      {license.notes && <p className="note-box">{license.notes}</p>}
      <textarea className="key-field" readOnly value={license.key} rows={4} />
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={() => onCopy(license.key)}>Copia chiave</button>
        <button type="button" className="secondary-button" onClick={() => onEdit(license)}>Modifica</button>
        {!license.revoked && <button type="button" className="danger-button" onClick={() => onRevoke(license.key)}>Revoca</button>}
        <button type="button" className="danger-button" onClick={() => onDelete(license.key)}>Elimina</button>
      </div>
    </aside>
  )
}

function EditLicenseModal({ license, token, onClose, onSaved }: {
  license: License
  token: string
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<EditLicenseForm>({
    customerId: license.customer_id,
    customerName: license.customer_name ?? '',
    licenseType: license.license_type,
    maxUsers: license.max_users,
    maxActivations: license.max_activations,
    features: featureText(parseLicenseFeatures(license.features)),
    notes: license.notes ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await requestJson(`/admin/licenses/${encodeURIComponent(license.key)}`, token, {
        method: 'PUT',
        body: JSON.stringify({
          customerId: form.customerId,
          customerName: form.customerName || null,
          licenseType: form.licenseType,
          maxUsers: Number(form.maxUsers),
          maxActivations: Number(form.maxActivations),
          features: parseFeatureInput(form.features),
          notes: form.notes || null,
        }),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito')
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof EditLicenseForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(current => ({ ...current, [key]: e.target.value }))
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>Modifica licenza</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>
        <p className="modal-note">Prodotto: <strong>{license.product_id}</strong> — La chiave licenza e la scadenza non cambiano. Per modificarle revoca e rigenera.</p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <section className="form-section">
            <label>
              ID cliente
              <input value={form.customerId} onChange={set('customerId')} required />
            </label>
            <label>
              Nome cliente
              <input value={form.customerName} onChange={set('customerName')} placeholder="ACME srl" />
            </label>
            <label>
              Tipo licenza
              <select value={form.licenseType} onChange={set('licenseType')}>
                {LICENSE_TYPE_OPTIONS.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </label>
          </section>
          <section className="form-section">
            <label>
              Utenti max
              <input type="number" value={form.maxUsers} onChange={set('maxUsers')} min={1} />
            </label>
            <label>
              Attivazioni max
              <input type="number" value={form.maxActivations} onChange={set('maxActivations')} min={1} />
            </label>
            <FeaturePicker value={form.features} onChange={features => setForm(current => ({ ...current, features }))} />
          </section>
          <section className="form-section wide">
            <label>
              Note interne
              <textarea value={form.notes} onChange={set('notes')} rows={3} />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="button-row">
              <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva modifiche'}</button>
              <button type="button" className="secondary-button" onClick={onClose}>Annulla</button>
            </div>
          </section>
        </form>
      </div>
    </div>
  )
}

function ProductMix({ products, licenses }: { products: Product[]; licenses: License[] }) {
  if (products.length === 0) return <EmptyState title="Catalogo vuoto" text="Aggiungi il primo prodotto licenziabile." />

  return (
    <table className="compact-table">
      <thead>
        <tr>
          <th>Prodotto</th>
          <th>Attive</th>
          <th>Totali</th>
        </tr>
      </thead>
      <tbody>
        {products.map(product => {
          const productLicenses = licenses.filter(license => license.product_id === product.id)
          return (
            <tr key={product.id}>
              <td>
                <strong>{product.name}</strong>
                <span>{product.id}</span>
              </td>
              <td>{productLicenses.filter(isActiveLicense).length}</td>
              <td>{productLicenses.length}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ExpiringList({ licenses }: { licenses: License[] }) {
  const sorted = [...licenses].sort((a, b) => Number(a.expires_at ?? 0) - Number(b.expires_at ?? 0)).slice(0, 5)
  if (sorted.length === 0) return <EmptyState title="Nessuna scadenza critica" text="Non ci sono licenze attive in scadenza nei prossimi 30 giorni." />

  return (
    <ul className="stack-list">
      {sorted.map(license => (
        <li key={license.id}>
          <strong>{license.customer_name || license.customer_id}</strong>
          <span>{license.product_id} - {formatExpiry(license)}</span>
        </li>
      ))}
    </ul>
  )
}

function RecentLicenses({ licenses }: { licenses: License[] }) {
  if (licenses.length === 0) return <EmptyState title="Nessuna licenza" text="Le nuove licenze appariranno qui." />

  return (
    <table className="compact-table">
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Prodotto</th>
          <th>Tipo</th>
          <th>Stato</th>
        </tr>
      </thead>
      <tbody>
        {licenses.map(license => (
          <tr key={license.id}>
            <td>
              <strong>{license.customer_name || license.customer_id}</strong>
              <span>{formatDate(license.created_at ?? license.issued_at)}</span>
            </td>
            <td>{license.product_id}</td>
            <td><TypeBadge type={license.license_type} /></td>
            <td><StatusBadge license={license} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone: string }) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={active ? 'active' : ''}>{children}</button>
}

function TypeBadge({ type }: { type: LicenseType }) {
  const label = LICENSE_TYPE_OPTIONS.find(option => option.id === type)?.label ?? type
  return <span className={`badge badge-${type}`}>{label}</span>
}

function StatusBadge({ license }: { license: License }) {
  if (license.revoked) return <span className="status-badge revoked">Revocata</span>
  if (isExpired(license)) return <span className="status-badge expired">Scaduta</span>
  if (isExpiringSoon(license)) return <span className="status-badge expiring">In scadenza</span>
  return <span className="status-badge active">Attiva</span>
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={active ? 'status-badge active' : 'status-badge archived'}>{active ? 'Attivo' : 'Archiviato'}</span>
}

function FeatureTags({ features }: { features: string[] }) {
  if (features.length === 0) return <span className="muted">Nessuna feature</span>
  return (
    <div className="feature-tags">
      {features.map(feature => <span key={feature}>{feature}</span>)}
    </div>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function requestJson<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data?.message === 'string'
      ? data.message
      : typeof data?.error === 'string'
        ? data.error
        : `HTTP ${res.status}`
    throw new ApiError(res.status, message)
  }

  return data as T
}

function parseFeatureInput(value: string): string[] {
  return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)))
}

function parseLicenseFeatures(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return parseFeatureInput(value)
  }
}

function featureText(features: string[]): string {
  return Array.from(new Set(features)).join(',')
}

function normalizeProductId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
}

function isActiveLicense(license: License): boolean {
  return !license.revoked && !isExpired(license)
}

function isExpired(license: License): boolean {
  return Boolean(license.expires_at && license.expires_at * 1000 < Date.now())
}

function isExpiringSoon(license: License): boolean {
  if (license.revoked || !license.expires_at || isExpired(license)) return false
  const days = (license.expires_at * 1000 - Date.now()) / 86400000
  return days <= 30
}

function formatExpiry(license: License): string {
  if (!license.expires_at) return 'Perpetua'
  return new Date(license.expires_at * 1000).toLocaleDateString('it-IT')
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('it-IT')
}

function productName(products: Product[], productId: string): string {
  return products.find(product => product.id === productId)?.name ?? productId
}

function applicationTypeLabel(type: ApplicationType): string {
  return APPLICATION_TYPE_OPTIONS.find(option => option.id === type)?.label ?? type
}

function bindingModeLabel(mode: BindingMode): string {
  return BINDING_MODE_OPTIONS.find(option => option.id === mode)?.label ?? mode
}

function defaultBindingModeForApplicationType(type: ApplicationType): BindingMode {
  const map: Record<ApplicationType, BindingMode> = {
    desktop: 'workstation',
    hybrid: 'server',
    web: 'tenant',
  }
  return map[type]
}

function copyText(value: string): void {
  navigator.clipboard?.writeText(value)
}
