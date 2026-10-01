const mockFindById = jest.fn();
const mockUpdate = jest.fn();
const mockUploadIfMissing = jest.fn();
const mockListFileNames = jest.fn();
const mockFindPending = jest.fn();
const mockMarkCloudArchived = jest.fn();

jest.mock("../services/cte.service", () => ({
  __esModule: true,
  CteService: class {},
  default: {},
}));
jest.mock("../../../../../handlers/uploader/services/uploader.service", () => ({
  __esModule: true,
  default: {
    uploadIfMissing: (...args: unknown[]) => mockUploadIfMissing(...args),
    listFileNames: (...args: unknown[]) => mockListFileNames(...args),
    normalizeDirectory: (d: string) => (d.startsWith("/") ? d : `/${d}`),
  },
}));

const mockIsEncrypted = jest.fn();
const mockDecryptXml = jest.fn();
jest.mock("../../../../../../shared/utils/xml/xml-cipher", () => ({
  isEncrypted: (v: string) => mockIsEncrypted(v),
  decryptXml: (v: string) => mockDecryptXml(v),
}));

import { CteXmlArchiveService } from "../services/cte-xml-archive.service";

const cteSvc = {
  findById: mockFindById,
  update: mockUpdate,
  findPendingCloudArchive: mockFindPending,
  markCloudArchived: mockMarkCloudArchived,
} as any;

describe("CteXmlArchiveService.archive", () => {
  const service = new CteXmlArchiveService(cteSvc);
  const originalDir = process.env.CTE_XML_DIRECTORY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CTE_XML_DIRECTORY = "paxhub/cte-xml";
    mockIsEncrypted.mockReturnValue(false);
  });

  afterAll(() => {
    process.env.CTE_XML_DIRECTORY = originalDir;
  });

  it("uploads the XML and stores cloud_path", async () => {
    mockFindById.mockResolvedValue({ id: "c1", number: 10, xml_path: "<xml/>", cloud_path: null });
    mockUploadIfMissing.mockResolvedValue("/paxhub/cte-xml/10_c1.xml");

    await service.archive("c1");

    expect(mockUploadIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "10_c1.xml",
        directory: "paxhub/cte-xml",
        preserveFilename: true,
        buffer: Buffer.from("<xml/>", "utf-8"),
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith("c1", { cloud_path: "/paxhub/cte-xml/10_c1.xml" });
  });

  it("decrypts an encrypted xml_path before uploading", async () => {
    mockFindById.mockResolvedValue({ id: "c1", number: 10, xml_path: "enc", cloud_path: null });
    mockIsEncrypted.mockReturnValue(true);
    mockDecryptXml.mockReturnValue("<plain/>");
    mockUploadIfMissing.mockResolvedValue("/p");

    await service.archive("c1");

    expect(mockUploadIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: Buffer.from("<plain/>", "utf-8") }),
    );
  });

  it("does nothing when the CT-e is gone or already archived", async () => {
    mockFindById.mockResolvedValueOnce(null);
    await service.archive("gone");

    mockFindById.mockResolvedValueOnce({ id: "c1", number: 1, xml_path: "<x/>", cloud_path: "/done" });
    await service.archive("c1");

    expect(mockUploadIfMissing).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("legacy URL xml_path is adopted as cloud_path without uploading", async () => {
    mockFindById.mockResolvedValue({ id: "c1", number: 1, xml_path: "https://x/y.xml", cloud_path: null });

    await service.archive("c1");

    expect(mockUploadIfMissing).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith("c1", { cloud_path: "https://x/y.xml" });
  });

  it("throws (job retries) when the upload fails and never sets cloud_path", async () => {
    mockFindById.mockResolvedValue({ id: "c1", number: 1, xml_path: "<x/>", cloud_path: null });
    mockUploadIfMissing.mockRejectedValue(new Error("nextcloud down"));

    await expect(service.archive("c1")).rejects.toThrow("nextcloud down");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws when CTE_XML_DIRECTORY is not configured instead of uploading to a wrong folder", async () => {
    delete process.env.CTE_XML_DIRECTORY;
    mockFindById.mockResolvedValue({ id: "c1", number: 1, xml_path: "<x/>", cloud_path: null });

    await expect(service.archive("c1")).rejects.toThrow("CTE_XML_DIRECTORY");
    expect(mockUploadIfMissing).not.toHaveBeenCalled();
  });

  it("throws when the CT-e has no XML stored", async () => {
    mockFindById.mockResolvedValue({ id: "c1", number: 1, xml_path: null, cloud_path: null });

    await expect(service.archive("c1")).rejects.toThrow("sem XML");
  });
});

describe("CteXmlArchiveService.reconcilePending", () => {
  const service = new CteXmlArchiveService(cteSvc);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CTE_XML_DIRECTORY = "paxhub/cte-xml";
  });

  it("does not touch the storage when nothing is pending", async () => {
    mockFindPending.mockResolvedValue([]);

    await expect(service.reconcilePending()).resolves.toEqual([]);
    expect(mockListFileNames).not.toHaveBeenCalled();
  });

  it("marks files already in the cloud in bulk and returns only the missing ids", async () => {
    mockFindPending.mockResolvedValue([
      { id: "a", number: 1 },
      { id: "b", number: 2 },
      { id: "c", number: 3 },
    ]);
    mockListFileNames.mockResolvedValue(new Set(["1_a.xml", "3_c.xml", "other.xml"]));

    await expect(service.reconcilePending()).resolves.toEqual(["b"]);

    expect(mockListFileNames).toHaveBeenCalledTimes(1);
    expect(mockMarkCloudArchived).toHaveBeenCalledWith(["a", "c"], "/paxhub/cte-xml");
  });

  it("skips the bulk update when every pending CT-e is missing", async () => {
    mockFindPending.mockResolvedValue([{ id: "a", number: 1 }]);
    mockListFileNames.mockResolvedValue(new Set());

    await expect(service.reconcilePending()).resolves.toEqual(["a"]);
    expect(mockMarkCloudArchived).not.toHaveBeenCalled();
  });

  it("propagates a listing failure without marking anything", async () => {
    mockFindPending.mockResolvedValue([{ id: "a", number: 1 }]);
    mockListFileNames.mockRejectedValue(new Error("storage down"));

    await expect(service.reconcilePending()).rejects.toThrow("storage down");
    expect(mockMarkCloudArchived).not.toHaveBeenCalled();
  });
});
