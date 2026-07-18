import { useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { submitCredential } from './projects.js'

// The ONE credential experience ([[projects-hub]]): the same calm card serves the administrator sign-in
// (hub scope, `/login`) and a per-project unlock (`/p/:id/login`) — one visual language, one component,
// the scope prop the only difference. It renders when a load came back 401/403 and posts through the
// narrow client; on success it hands control back to the caller (onUnlocked), which re-runs whatever was
// denied — the fresh httpOnly cookie does the rest, so this component never holds a secret beyond the
// in-flight field. The 'locked' variant (a gateway with no admin verifier, reached from off-loopback) is
// a dead end by design: no form, just the repair path — set the password from the machine itself.
export default function CredentialGate({ scope, projectLabel, locked, onUnlocked }) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isAdmin = scope === 'admin'

  const submit = async (e) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true); setError(null)
    const r = await submitCredential(isAdmin ? 'admin' : { projectId: scope.projectId }, password)
    setBusy(false)
    if (r.ok) { setPassword(''); onUnlocked() }
    else setError(r.error === 'wrong-password' ? t('credential.wrong') : t('credential.failed'))
  }

  return (
    <div className="cred-wrap">
      <form className="cred-card" onSubmit={submit}>
        <div className="cred-brand">$ spexcode</div>
        <div className="cred-title">
          <Icon name="lock" size={14} className="cred-lock" />
          {locked ? t('credential.lockedTitle') : isAdmin ? t('credential.adminTitle') : t('credential.projectTitle', { name: projectLabel || (scope && scope.projectId) || '' })}
        </div>
        {locked ? (
          <p className="cred-sub">{t('credential.lockedBody')}</p>
        ) : (
          <>
            <p className="cred-sub">{isAdmin ? t('credential.adminBody') : t('credential.projectBody')}</p>
            {error && <div className="cred-err">{error}</div>}
            <input
              className="cred-input"
              type="password"
              autoFocus
              required
              placeholder="••••••••••"
              aria-label={t('credential.passwordLabel')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="cred-submit" type="submit" disabled={busy || !password}>
              {busy ? t('credential.checking') : t('credential.unlock')}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
