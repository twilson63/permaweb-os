export default {
  logo: <span style={{ fontWeight: 700, fontSize: '1.2rem' }}>Permaweb OS</span>,
  project: {
    link: 'https://github.com/twilson63/permaweb-os',
  },
  docsRepositoryBase: 'https://github.com/twilson63/permaweb-os',
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Permaweb OS',
    }
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="Permaweb OS" />
      <meta property="og:description" content="A Kubernetes-based platform for running isolated OpenCode pods with HTTPSig authentication." />
      <link rel="icon" href="/favicon.ico" />
    </>
  ),
  primaryHue: 200,
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  footer: {
    text: (
      <span>
        {new Date().getFullYear()} © Permaweb OS. Built with Nextra.
      </span>
    ),
  },
}