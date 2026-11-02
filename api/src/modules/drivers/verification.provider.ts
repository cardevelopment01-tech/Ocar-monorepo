import { RekognitionClient, DetectFacesCommand, CompareFacesCommand, DetectTextCommand } from '@aws-sdk/client-rekognition'
import { config } from '@/config'
import { awsCredentials } from '@/lib/aws-credentials'

// Thin wrapper over Rekognition: three calls, a per-call timeout, no business rules. Images are passed as S3 objects
// (the bucket and Rekognition share a region, S3_REGION), so no image bytes go through the API process.
const client = new RekognitionClient({ region: config.S3_REGION, ...awsCredentials() })

const CALL_TIMEOUT_MS = 3000

function image(key: string) {
  return { S3Object: { Bucket: config.S3_BUCKET_NAME, Name: key } }
}

export interface FaceScan {
  faceCount: number
  quality: { brightness: number; sharpness: number; yaw: number; pitch: number } | null
}

export async function detectFaces(key: string): Promise<FaceScan> {
  const res = await client.send(new DetectFacesCommand({ Image: image(key), Attributes: ['DEFAULT'] }), {
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  const faces = res.FaceDetails ?? []
  const f = faces.length === 1 ? faces[0]! : null
  const quality = f && f.Quality && f.Pose
    ? {
        brightness: f.Quality.Brightness ?? 0,
        sharpness: f.Quality.Sharpness ?? 0,
        yaw: f.Pose.Yaw ?? 0,
        pitch: f.Pose.Pitch ?? 0,
      }
    : null
  return { faceCount: faces.length, quality }
}

// Highest similarity of the target face to the source face, or null when nothing reached `floor`. The floor is kept low
// (below the review band) because CompareFaces drops matches under it instead of returning their score.
export async function compareFaces(sourceKey: string, targetKey: string, floor: number): Promise<number | null> {
  const res = await client.send(
    new CompareFacesCommand({
      SourceImage: image(sourceKey),
      TargetImage: image(targetKey),
      SimilarityThreshold: floor,
      QualityFilter: 'NONE',
    }),
    { abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS) }
  )
  const best = Math.max(0, ...(res.FaceMatches ?? []).map((m) => m.Similarity ?? 0))
  return best > 0 ? best : null
}

export async function detectText(key: string): Promise<{ text: string; confidence: number }[]> {
  const res = await client.send(new DetectTextCommand({ Image: image(key) }), {
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  return (res.TextDetections ?? [])
    .filter((t) => t.Type === 'LINE' && t.DetectedText)
    .map((t) => ({ text: t.DetectedText!, confidence: t.Confidence ?? 0 }))
}
