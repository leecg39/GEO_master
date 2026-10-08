import type { Metadata } from "next";
import { ReviewClient } from "@/components/ReviewClient";

export const metadata: Metadata = { title: "검수함" };
export default function ReviewPage() { return <ReviewClient />; }
