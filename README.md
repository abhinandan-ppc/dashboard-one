<div align="center">
<h1>🏭 Dashboard One</h1>
<p><b>A comprehensive suite of static dashboards for industrial planning, yard management, and logistics tracking.</b></p>
<p>
    <img src="https://github.com/abhinandan-ppc/dashboard-one/actions/workflows/deploy-pages.yml/badge.svg" alt="Deploy to GitHub Pages">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
  </p>
</div>
---
📖 About The Project
Dashboard One provides a centralized interface for managing complex industrial operations. Instead of relying on a heavy backend framework, this project utilizes fast, static HTML files to serve dedicated planning tools for Steel Melting Shops (SMS), plate tagging, and rake (railway) logistics.
Optimized for automated deployment via GitHub Pages, it utilizes a `.nojekyll` configuration to ensure seamless static file serving.
---
📊 Dashboard Modules
Here is the suite of standalone dashboard views, each tailored to a specific operational requirement:
<table width="100%">
  <tr>
    <td width="50%">
      <h3>🏠 Main Hub</h3>
      <code>index.html</code>
      <p>The central landing page connecting all operational planners and views.</p>
    </td>
    <td width="50%">
      <h3>🏗️ PM Yard</h3>
      <code>PM-Yard.html</code>
      <p>Dedicated interface for industrial yard management and tracking.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>🏷️ PSFS Tagging</h3>
      <code>PSFS_Tagging_Dashboard.html</code>
      <p>Dashboard for monitoring and analyzing PSFS tagging metrics.</p>
    </td>
    <td>
      <h3>🪧 Plate Tagging Tool</h3>
      <code>Plate-Tagging-Tool.html</code>
      <p>Tool for seamlessly tracking and logging industrial plate tags.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>🚆 Rake Planner</h3>
      <code>Rake-Planner.html</code>
      <p>Logistics planner for managing railway rakes, scheduling, and wagon loading.</p>
    </td>
    <td>
      <h3>🔥 SMS Heat Planner</h3>
      <code>SMS-Heat-Planner.html</code>
      <p>The core planner for Steel Melting Shop (SMS) heat operations.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>📅 SMS Heat (Daily)</h3>
      <code>SMS Heat Planner Daily.html</code>
      <p>Daily granular tracking for Steel Melting Shop heat cycles.</p>
    </td>
    <td>
      <h3>📆 SMS Heat (Monthly)</h3>
      <code>SMS Heat Planner Monthly.html</code>
      <p>High-level monthly overview and forecasting of SMS heat schedules.</p>
    </td>
  </tr>
</table>
---
🛠️ Tech Stack & Architecture
> ⚡ **Frontend:** Pure HTML / JS / CSS for lightweight, fast rendering.
> 
> ☁️ **Hosting:** GitHub Pages.
> 
> ⚙️ **CI/CD Pipeline:** Configured using GitHub Actions (`deploy-pages.yml`) for automated deployments.
> 
> 🔧 **Build Configuration:** Includes a `.nojekyll` file to bypass standard Jekyll processing, ensuring standard HTML routing works as intended.
---
🚀 Quick Start
Since this project consists of static HTML files, getting started is incredibly simple. You do not need a complex local development server to view the dashboards.
💻 Local Development
Clone the repository
```sh
   git clone https://github.com/abhinandan-ppc/dashboard-one.git
   ```
Navigate into the directory
```sh
   cd dashboard-one
   ```
Launch the app
Simply double-click `index.html` to open it in your default web browser, or use a tool like VS Code Live Server for real-time reloading.
🌍 Deployment
This project is configured to automatically deploy to GitHub Pages. Any pushes to the main branch will trigger the `.github/workflows/deploy-pages.yml` action and update your live site.
---
<div align="center">
  <br>
  <i>Built by <a href="https://github.com/abhinandan-ppc">Abhinandan</a></i>
</div>
