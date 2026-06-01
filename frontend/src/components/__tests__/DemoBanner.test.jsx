import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n/index.jsx'
import { DemoBanner } from '../DemoBanner'

describe('DemoBanner', () => {
  it('renders the demo notice text', () => {
    render(
      <I18nProvider>
        <DemoBanner />
      </I18nProvider>,
    )
    // Default locale message mentions the browser-only guarantee.
    expect(screen.getByText(/browser|браузер/i)).toBeTruthy()
  })
})
