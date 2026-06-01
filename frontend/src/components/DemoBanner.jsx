import { useI18n } from '../i18n/index.jsx'

// Shown only in demo mode. Reassures public visitors that nothing they upload is
// stored on the server — the signature library and signing history live only in
// their own browser and are gone when they clear site data.
export function DemoBanner() {
  const { t } = useI18n()
  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-1.5 text-amber-800 text-xs text-center">
      {t('demo.banner')}
    </div>
  )
}
