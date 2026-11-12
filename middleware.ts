import { withAuth } from "next-auth/middleware";

export default withAuth({ pages: { signIn: "/login" } });

// Everything except the login page, auth endpoints, public share pages
// (/s/<token>, read-only stats), app icons, the web manifest and static files
// needs a session.
export const config = {
  matcher: ["/((?!login|api/auth|s/|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest).*)"],
};
