import { createBrowserRouter } from "react-router";

// T5.0 placeholder: one "coming soon" screen so the app builds while the
// dormant screens live under ./legacy. Handed over to Andrew on R0 day 1.
function ComingSoon() {
  return <div className="text-white p-10 font-bold text-2xl">Coming soon</div>;
}

export const router = createBrowserRouter([{ path: "*", Component: ComingSoon }]);
