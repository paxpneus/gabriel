jest.mock("../uploader-image-cache", () => ({
  getCachedImage: jest.fn(),
  setCachedImage: jest.fn(),
  invalidateCachedImage: jest.fn(),
}));

import { UploaderService } from "../services/uploader.service";

describe("UploaderService.uploadIfMissing", () => {
  const api = { head: jest.fn(), put: jest.fn(), request: jest.fn() };
  const service = new UploaderService(api as any);
  const input = {
    buffer: Buffer.from("<x/>"),
    filename: "1_a.xml",
    mimeType: "application/xml",
    directory: "paxhub/cte-xml",
    preserveFilename: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.request.mockResolvedValue({});
    api.put.mockResolvedValue({});
  });

  it("returns the canonical path without PUT when the file already exists", async () => {
    api.head.mockResolvedValue({});

    await expect(service.uploadIfMissing(input)).resolves.toBe("/paxhub/cte-xml/1_a.xml");
    expect(api.head).toHaveBeenCalledWith("/paxhub/cte-xml/1_a.xml");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("uploads when HEAD says 404", async () => {
    api.head.mockRejectedValue({ response: { status: 404 } });

    await expect(service.uploadIfMissing(input)).resolves.toBe("/paxhub/cte-xml/1_a.xml");
    expect(api.put).toHaveBeenCalledWith(
      "/paxhub/cte-xml/1_a.xml",
      input.buffer,
      expect.anything(),
    );
  });

  it("propagates non-404 HEAD errors instead of uploading blindly", async () => {
    api.head.mockRejectedValue({ response: { status: 500 }, message: "boom" });

    await expect(service.uploadIfMissing(input)).rejects.toThrow("boom");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("requires preserveFilename", async () => {
    await expect(service.uploadIfMissing({ ...input, preserveFilename: false })).rejects.toThrow(
      "preserveFilename",
    );
  });
});

describe("UploaderService.listFileNames", () => {
  const api = { request: jest.fn() };
  const service = new UploaderService(api as any);

  beforeEach(() => jest.clearAllMocks());

  it("lists the directory with a single PROPFIND Depth 1 and returns basenames", async () => {
    api.request.mockResolvedValue({
      data: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/remote.php/dav/files/u/paxhub/cte-xml/</d:href></d:response>
        <d:response><d:href>/remote.php/dav/files/u/paxhub/cte-xml/1_a.xml</d:href></d:response>
        <d:response><d:href>/remote.php/dav/files/u/paxhub/cte-xml/2_b%20c.xml</d:href></d:response>
      </d:multistatus>`,
    });

    const names = await service.listFileNames("paxhub/cte-xml");

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PROPFIND",
        url: "/paxhub/cte-xml",
        headers: expect.objectContaining({ Depth: "1" }),
      }),
    );
    expect(names.has("1_a.xml")).toBe(true);
    expect(names.has("2_b c.xml")).toBe(true);
  });

  it("returns an empty set when the directory does not exist yet", async () => {
    api.request.mockRejectedValue({ response: { status: 404 } });

    await expect(service.listFileNames("paxhub/cte-xml")).resolves.toEqual(new Set());
  });

  it("propagates other errors instead of pretending the directory is empty", async () => {
    api.request.mockRejectedValue({ response: { status: 429 }, message: "too many" });

    await expect(service.listFileNames("paxhub/cte-xml")).rejects.toThrow("too many");
  });
});
