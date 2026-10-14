


import { useEffect } from "react";
import { useLocation, useNavigate, useRoutes } from "react-router-dom";

import Dashboard from "./dashboard/Dashboard";
import Profile from "./user/Profile";
import Repo from "./repo/Repo";
import Issue from "./issue/Issue";
import Login from "./auth/Login";
import Signup from "./auth/Signup";

import { useAuth } from "../useAuth";

const ProjectRoutes = () => {
  const { currentUser, setCurrentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const userIdFromStorage = localStorage.getItem("userId");

    if (userIdFromStorage && !currentUser) {
      setCurrentUser(userIdFromStorage);
    }

    if (
      !userIdFromStorage &&
      !["/auth", "/signup"].includes(location.pathname)
    ) {
      navigate("/auth");
    }

    if (userIdFromStorage && ["/auth", "/signup"].includes(location.pathname)) {
      navigate("/");
    }
  }, [currentUser, location.pathname, navigate, setCurrentUser]);

  const element = useRoutes([
    {
      path: "/",
      element: <Dashboard />,
    },
    {
      path: "/dashboard",
      element: <Dashboard />,
    },
    {
      path: "/auth",
      element: <Login />,
    },
    {
      path: "/signup",
      element: <Signup />,
    },
    {
      path: "/profile",
      element: <Profile />,
    },
    {
      path: "/create",
      element: <Repo />,
    },
    {
      path: "/repo/:repoId",
      element: <Repo />,
    },
    {
      path: "/repo/:repoId/issues",
      element: <Issue />,
    },
    {
      path: "/repo/:repoId/issues/:issueId",
      element: <Issue />,
    },
  ]);

  return element;
};

export default ProjectRoutes;