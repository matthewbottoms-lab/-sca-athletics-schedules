# SCA Athletics Schedule Mirror

This repository mirrors two already-public SCA SharePoint workbooks to GitHub Pages so they can be read reliably without a Microsoft sign-in:

- Field & Gym Schedule
- Transportation Schedule

The GitHub Action refreshes the schedules twice per hour in the `America/Phoenix` timezone and can also be run manually from the Actions tab.

## One-time setup

1. Create a **public** GitHub repository, for example `sca-athletics-schedules`.
2. Upload **all files and folders from this package**, including the hidden `.github` folder, to the repository's `main` branch.
3. Open **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open **Actions → Refresh SCA schedules** and choose **Run workflow** once.
6. After the run succeeds, the Pages URL will be:
   `https://YOUR-GITHUB-USERNAME.github.io/sca-athletics-schedules/`

Useful endpoints:

- `facilities.html` — human-readable Field/Gym schedule
- `facilities.json` — machine-readable Field/Gym schedule
- `transportation.html` — human-readable transportation schedule
- `transportation.json` — machine-readable transportation schedule
- `status.json` — last refresh time and fetch status

## Notes

The source workbooks are already anonymously/publicly shared. This repository does not contain Microsoft credentials and does not bypass authentication.
