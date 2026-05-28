/**
 * Strait — machine-enforced module boundaries (inherited from Lira-Bridge
 * ARCH-1 Phase 2).
 *
 * Rules:
 *  (a) The member web tree and the admin web tree must not import each
 *      other (different security postures / separate JWT audiences).
 *      client/src/App.tsx + main.tsx are the single composition root and
 *      are intentionally outside both trees, so they may wire both.
 *  (b) A src/ module must consume another module through its Nest-exported
 *      service/interface, never by reaching into its *.repository.ts.
 *      Exempt files are Nest providers that consume an explicitly-exported
 *      repository from another module — those exact source files are the
 *      only documented exceptions.
 *  (c) Raw process.env is forbidden outside the two sanctioned env seams
 *      (enforced by scripts/check-no-process-env.js, not here).
 */
module.exports = {
  forbidden: [
    {
      name: 'web-member-no-admin',
      comment:
        'Member web tree must not import the admin tree (separate security posture / JWT audience). App.tsx/main.tsx is the only allowed composition root.',
      severity: 'error',
      from: { path: '^client/src/(member|pages|hooks|components)/' },
      to: { path: '^client/src/admin/' },
    },
    {
      name: 'web-admin-no-member',
      comment:
        'Admin web tree must not import member feature code (separate security posture / JWT audience).',
      severity: 'error',
      from: { path: '^client/src/admin/' },
      to: { path: '^client/src/(member|pages|hooks|components)/' },
    },
    {
      name: 'no-cross-module-repository-reachground',
      comment:
        'Consume another src/ module via its Nest-exported service/interface — never reach into its *.repository.ts. Same-module imports are fine. Exempt files consume repositories that their owning modules explicitly export.',
      severity: 'error',
      from: {
        path: '^src/([^/]+)/',
        pathNot: [
          '^src/dispatch/dispatch\\.service\\.ts$',
          '^src/state-machine/state-machine\\.service\\.ts$',
        ],
      },
      to: {
        path: '^src/[^/]+/.*\\.repository\\.ts$',
        pathNot: ['^src/$1/'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    exclude: {
      path: '(^|/)node_modules/|/dist/|\\.spec\\.ts$|(^|/)test/integration/',
    },
  },
};
