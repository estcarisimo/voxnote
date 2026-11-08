/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google Analytics 4 measurement id for visit counting. Set at build time
   * (on GitHub Pages from the repository variable of the same name); unset
   * means no analytics at all.
   */
  readonly VITE_GA_MEASUREMENT_ID?: string
}

/** package.json `version`, replaced at build time; see vite.config.ts. */
declare const __APP_VERSION__: string
