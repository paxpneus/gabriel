import { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../config/axios";

const email = process.env.UPLOADER_EMAIL!;
const password = process.env.UPLOADER_PASSWORD!;
const baseURL = process.env.UPLOADER_URL!;

const basic = Buffer
  .from(`${email}:${password}`)
  .toString("base64");

const uploaderApi: AxiosInstance = createAxiosInstance({
  baseURL,
  timeout: 15_000,
  headers: {
    Accept: '*/*',
    Authorization: `Basic ${basic}`
  }
});

export default uploaderApi;