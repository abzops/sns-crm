# Stack n Stock CRM - Final Operational V1

This package is the final V1 dashboard build. It is designed to open and work immediately without waiting for a backend.

## What works immediately

- 30 seeded Stack n Stock CRM accounts from the bundled CRM workbook
- Dashboard KPIs
- Account search, filters, sorting, and CSV export
- Create, edit, and delete accounts
- Pipeline board with drag-and-drop stage updates
- Follow-up/task desk
- Competitor intelligence, market share, overlap matrix, and competitor CRUD
- Local persistence through browser localStorage
- Reset local demo data from the Setup page
- Supabase-ready mode when you want live backend sync

## Important default

`js/config.js` has:

```js
FORCE_LOCAL_MODE: true
```

This is intentional for Final V1 so the dashboard has data and all buttons work immediately. After your Supabase schema and policies are ready, change it to:

```js
FORCE_LOCAL_MODE: false
```

Then the same UI will use your Supabase tables.

## Supabase setup

1. Open Supabase SQL Editor.
2. Run `supabase_schema.sql`.
3. Put your project URL and anon key in `js/config.js`.
4. Set `FORCE_LOCAL_MODE: false`.
5. Host the folder as a static site.

## Files

- `index.html` - final CRM UI
- `css/styles.css` - Stack n Stock styling and container-style buttons
- `js/app.js` - dashboard logic, local persistence, Supabase CRUD path
- `js/seed-data.js` - bundled operational seed data
- `js/config.js` - local/Supabase mode settings
- `supabase_schema.sql` - backend schema
- `assets/stacknstock-logo.png` - navbar/brand logo
- `assets/favicon.png` - favicon only
