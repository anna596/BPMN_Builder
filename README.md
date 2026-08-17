# BPMN Builder

A web-based BPMN diagram editor with augmented reality support, built as part of a Master's thesis. It supports desktop, as well as direct and indirect interaction in AR.

**Live demo**: [bpmn-builder.onrender.com](https://bpmn-builder.onrender.com/)

## Requirements

- Node.js 18+
- A WebXR-capable headset with hand-tracking enabled, e.g. Meta Quest *(only needed for XR features)*

## Run locally

**Install Dependencies**: Inside the `frontend` folder, run:
```sh
npm install
```

**Start Development Server**: Then start the dev server:
```sh
npm run dev
```

Open the HTTPS URL shown in the terminal. On a headset, enter the URL in the browser and tap **Enter AR**.
