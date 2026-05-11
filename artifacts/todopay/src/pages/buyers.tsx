import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Buyers() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/members"); }, [setLocation]);
  return null;
}
