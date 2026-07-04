import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listDesigns from "./tools/list-designs";
import getDesign from "./tools/get-design";
import listReviews from "./tools/list-reviews";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "printbuild-mcp",
  title: "PrintBuild",
  version: "0.1.0",
  instructions:
    "Tools for PrintBuild — a home-design app. Use list_designs to browse the user's saved home designs, get_design to inspect one in detail (spec, Vastu, generated variations), and list_reviews to read their reviews.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listDesigns, getDesign, listReviews],
});
