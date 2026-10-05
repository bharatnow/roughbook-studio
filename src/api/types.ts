// What the backend's /studio routes answer. Kept by hand beside the backend's validators; the
// route tests on both sides pin the shapes.

export type OrgRole = 'owner' | 'editor' | 'viewer';

export type DeviceLogin = {
  deviceCode: string;
  /** ABCD-EFGH, typed by the designer at /link. */
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type IssuedInstall = { token: string; installId: string };

export type Me = { user: { id: string; email: string; name: string | null } };

export type OrgProjects = {
  id: string;
  name: string;
  role: OrgRole;
  projects: { slug: string; name: string }[];
};

export type LinkResult = {
  linkId: string;
  org: { id: string; name: string };
  project: { slug: string; name: string };
};
