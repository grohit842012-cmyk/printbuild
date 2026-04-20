

# Custom Home Designer & 3D Booking Platform

A web app where customers describe their dream home through a guided form + AI chat (now including Vastu preferences), see 10 generated 3D models with curved walls, view 2D floor plans, and book — triggering per-floor, per-wall STL exports for you to fabricate.

## Customer journey

1. **Landing page** — explains the concept, showcases sample homes, CTA to start designing.
2. **Sign up / log in** — email + password, customers can save designs and revisit.
3. **Design wizard (form)** — step-by-step:
   - Plot dimensions, shape, and **plot orientation (which direction the plot faces — N/S/E/W/NE/etc.)**
   - Number of floors
   - Rooms per floor (bedrooms, kitchen, living, bath, pooja room, etc.) with size preferences
   - Curvature style (gentle, bold organic, mixed straight + curved)
   - Roof style, window density, exterior feel
   - Budget feel & lifestyle (family size, work-from-home, entertaining, etc.)
   - **Vastu preferences**:
     - Follow Vastu? (Strict / Flexible / Not important)
     - Main entrance direction preference
     - Pooja / prayer room (yes/no + preferred direction, e.g. NE)
     - Kitchen direction (e.g. SE)
     - Master bedroom direction (e.g. SW)
     - Water element / borewell placement (e.g. NE)
     - Open space / courtyard preferences
     - Any custom Vastu notes
4. **AI chat refinement** — conversational AI asks follow-ups based on form answers, including Vastu clarifications ("you chose strict Vastu but want a south-facing entrance — should I prioritize Vastu rules or your direction preference?").
5. **10 model generation** — system generates 10 parametric variations honoring the spec **and Vastu constraints** (room placement by direction, entrance orientation, pooja room in NE, etc.).
6. **Gallery view** — thumbnails of all 10 models with a small **Vastu compliance badge** (e.g. "Strict Vastu", "Mostly compliant") on each.
7. **Model inspector** — interactive 3D viewer (rotate, zoom, pan), toggle floor visibility, 2D top-down floor plan per floor with **compass/direction indicator overlay** so customers can verify Vastu alignment.
8. **Like / dislike / regenerate** — keep favorites, dismiss others, request another batch with adjusted parameters.
9. **Book this design** — confirms order, captures shipping/contact details.
10. **My designs** — saved designs and booking history.

## Admin dashboard (you)

- Login-protected admin area.
- Bookings list with customer info, date, status, model thumbnail, **Vastu compliance level**.
- Order detail view: full spec (incl. Vastu choices), 3D preview, customer notes.
- **Download STL bundle**: ZIP file with one STL per wall organized by floor (`floor-1/wall-north.stl`, etc.) plus floor slabs and roof.
- Order status workflow: New → In Production → Shipped → Delivered.
- Internal notes & customer messaging thread.

## How the 3D + STL works

- **Three.js** in the browser renders interactive previews and the 2D plan projection with a compass overlay.
- **Curved walls** built as lofted geometry along bezier curves with configurable thickness and height.
- **Parametric generator** takes the spec + Vastu rules and produces 10 variations by perturbing curvature, room arrangement (within Vastu constraints), and openings.
- **Vastu rule engine** maps room types to preferred directions and validates each generated layout, scoring compliance.
- **STL export** runs server-side when a booking is placed: rebuilds the chosen model, splits per-wall and per-floor, zips it, stores in cloud storage, downloadable from the admin panel.
- **AI** powers the chat refinement step (asks smart follow-up questions, resolves Vastu vs preference conflicts, translates intent into parameters).

## Backend & data

- Authentication for customers and admin (separate role).
- Tables: `profiles`, `user_roles`, `designs` (spec incl. `vastu_preferences` JSON + chosen variation), `bookings` (status, contact, shipping), `stl_bundles` (storage path).
- Cloud storage bucket for generated STL ZIP files.
- Row-level security so customers see only their own designs/bookings; admin sees all.

## Visual direction

Clean, architectural, premium feel — large 3D viewer, soft shadows, generous whitespace, neutral palette with a single accent color. Compass/Vastu overlay uses subtle, non-intrusive iconography. Mobile-friendly browsing; the 3D designer optimized for tablet/desktop.

## Out of scope (v1)

- Online payment (booking only — you contact customer for payment offline).
- Real-time print job tracking, structural engineering validation, material cost estimates, certified Vastu consultant review.

