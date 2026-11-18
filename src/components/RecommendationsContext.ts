import { createContext } from "react";

/**
 * True on the pages that tune recommendations: For You and a library's Recommended (#179). Cards
 * there offer Not Interested in their menu; elsewhere they don't.
 */
export const RecommendationsContext = createContext(false);
