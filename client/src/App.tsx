import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import History from "./pages/History";
import Home from "./pages/Home";
import Monitors from "./pages/Monitors";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import Setup from "./pages/Setup";

function Router() {
  return <Switch><Route path="/login" component={Login} /><Route path="/setup" component={Setup} /><Route path="/" component={Home} /><Route path="/monitors" component={Monitors} /><Route path="/history" component={History} /><Route path="/settings" component={Settings} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
