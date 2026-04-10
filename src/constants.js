export const REGIONAL_AUTHORITIES = [
  { name: "Central", number: 6552, org: "Amplify", folder: "Amplify Central - 6552" },
  { name: "Central East", number: 5728, org: "Amplify", folder: "Amplify Central East - 5728" },
  { name: "Central West", number: 6553, org: "Amplify", folder: "Amplify Central West - 6553" },
  { name: "Champlain", number: 3782, org: "Amplify", folder: "Amplify Champlain - 3782" },
  { name: "ESC", number: 3783, org: "Amplify", folder: "Amplify ESC - 3783" },
  { name: "HNHB", number: 5296, org: "Amplify", folder: "Amplify HNHB - 5296" },
  { name: "Mississauga", number: 6554, org: "Amplify", folder: "Amplify Mississauga - 6554" },
  { name: "North East", number: 3781, org: "Amplify", folder: "Amplify North East - 3781" },
  { name: "North Simcoe", number: 6551, org: "Amplify", folder: "Amplify North Simcoe - 6551" },
  { name: "North West", number: 5727, org: "Amplify", folder: "Amplify North West - 5727" },
  { name: "Provincial", number: 7512, org: "Amplify", folder: "Amplify Provincial - 7512" },
  { name: "South East", number: 3780, org: "Amplify", folder: "Amplify South East - 3780" },
  { name: "South West", number: 3784, org: "Amplify", folder: "Amplify South West - 3784" },
  { name: "Toronto Central", number: 6548, org: "Amplify", folder: "Amplify Toronto Central - 6548" },
  { name: "Waterloo Wellington", number: 3288, org: "Amplify", folder: "Amplify Waterloo Wellington - 3288" },
  { name: "Ontario Health eReferral Program", number: 17959, org: "Ontario Health", folder: "OH Network - 17959" },
];

export function matchFolderToRA(folderName) {
  const match = folderName.match(/[-\u2013]\s*(\d+)\s*$/);
  if (match) {
    const num = parseInt(match[1], 10);
    return REGIONAL_AUTHORITIES.find((r) => r.number === num) || null;
  }
  return null;
}

export const FILE_TYPES = [
  {
    key: "listings",
    label: "Export Listings",
    markers: ["ref", "serviceDescription", "eReferral management"],
  },
  {
    key: "sites",
    label: "Export Sites",
    markers: ["Site Number", "# of Approved Listings", "EMR"],
  },
  {
    key: "users",
    label: "Export Users",
    markers: ["UserName", "ClinicianType", "DateOfAgreement"],
  },
  {
    key: "referrals",
    label: "Referral Analytics",
    markers: ["referralRef", "referralState", "referralCreationDate"],
  },
];

export const DUP_CONFIG = {
  listings: {
    keyCol: "ref",
    contextCols: ["title", "siteName", "siteNum"],
  },
  sites: {
    keyCol: "Site Number",
    contextCols: ["Site Name", "EMR"],
  },
  referrals: {
    keyCol: "referralRef",
    contextCols: ["referralState", "referralCreationDate", "recipientName", "siteNum"],
  },
};

export function detectFileType(headers) {
  for (const ft of FILE_TYPES) {
    const matched = ft.markers.filter((m) => headers.includes(m));
    if (matched.length >= 2) return ft;
  }
  return null;
}

export const TYPE_COLORS = { listings: "blue", sites: "green", users: "amber", referrals: "rose" };
