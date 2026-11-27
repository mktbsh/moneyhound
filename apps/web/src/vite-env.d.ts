/// <reference types="vite/client" />

/** Apps Script client bridge. Present only when served by HtmlService. */
interface GoogleScriptRunner {
  withSuccessHandler(handler: (value: unknown) => void): GoogleScriptRunner
  withFailureHandler(handler: (error: Error) => void): GoogleScriptRunner
  [server: string]: unknown
}

interface Window {
  google?: {
    script?: {
      run: GoogleScriptRunner
    }
  }
}
