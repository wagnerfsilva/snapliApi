const {
    CreateCollectionCommand,
    DeleteCollectionCommand,
    IndexFacesCommand,
    SearchFacesByImageCommand,
    DetectFacesCommand,
    DeleteFacesCommand
} = require('@aws-sdk/client-rekognition');
const { rekognitionClient, rekognition } = require('../config/aws');
const logger = require('../utils/logger');

class RekognitionService {
    /**
     * Create face collection (run once on setup)
     */
    async createCollection(collectionId = null) {
        try {
            const id = collectionId || rekognition.collectionId;

            const command = new CreateCollectionCommand({
                CollectionId: id
            });

            const response = await rekognitionClient.send(command);

            logger.info(`Coleção criada: ${id}`, response);

            return response;
        } catch (error) {
            if (error.name === 'ResourceAlreadyExistsException') {
                logger.info(`Coleção já existe: ${collectionId || rekognition.collectionId}`);
                return { exists: true };
            }
            logger.error('Erro ao criar coleção:', error);
            throw error;
        }
    }

    /**
     * Delete face collection
     */
    async deleteCollection(collectionId = null) {
        try {
            const id = collectionId || rekognition.collectionId;

            const command = new DeleteCollectionCommand({
                CollectionId: id
            });

            await rekognitionClient.send(command);

            logger.info(`Coleção deletada: ${id}`);
        } catch (error) {
            logger.error('Erro ao deletar coleção:', error);
            throw error;
        }
    }

    /**
     * Detect faces in an image
     */
    async detectFaces(imageBuffer) {
        try {
            const command = new DetectFacesCommand({
                Image: {
                    Bytes: imageBuffer
                },
                Attributes: ['ALL']
            });

            const response = await rekognitionClient.send(command);

            return {
                faceCount: response.FaceDetails?.length || 0,
                faces: response.FaceDetails || []
            };
        } catch (error) {
            logger.error('Erro ao detectar faces:', error);
            throw new Error(`Erro na detecção facial: ${error.message}`);
        }
    }

    /**
     * Index faces from image to collection
     */
    async indexFaces(imageBuffer, externalImageId) {
        try {
            const command = new IndexFacesCommand({
                CollectionId: rekognition.collectionId,
                Image: {
                    Bytes: imageBuffer
                },
                ExternalImageId: externalImageId,
                DetectionAttributes: ['ALL'],
                MaxFaces: 10,
                QualityFilter: 'AUTO'
            });

            const response = await rekognitionClient.send(command);

            const indexedFaces = response.FaceRecords || [];

            logger.info(`Faces indexadas: ${indexedFaces.length} para imagem ${externalImageId}`);

            return {
                faceCount: indexedFaces.length,
                faces: indexedFaces.map(record => ({
                    faceId: record.Face.FaceId,
                    boundingBox: record.Face.BoundingBox,
                    confidence: record.Face.Confidence,
                    imageId: record.Face.ImageId,
                    externalImageId: record.Face.ExternalImageId
                })),
                unindexedFaces: response.UnindexedFaces || []
            };
        } catch (error) {
            logger.error('Erro ao indexar faces:', error);
            throw new Error(`Erro ao indexar faces: ${error.message}`);
        }
    }

    /**
     * Search for matching faces in collection
     */
    async searchFacesByImage(imageBuffer, maxFaces = 100) {
        try {
            const command = new SearchFacesByImageCommand({
                CollectionId: rekognition.collectionId,
                Image: {
                    Bytes: imageBuffer
                },
                MaxFaces: maxFaces,
                FaceMatchThreshold: rekognition.similarityThreshold,
                QualityFilter: 'AUTO'
            });

            const response = await rekognitionClient.send(command);

            const matches = response.FaceMatches || [];

            logger.info(`Busca facial encontrou ${matches.length} correspondências`);

            return {
                matchCount: matches.length,
                searchedFace: response.SearchedFaceBoundingBox,
                searchedFaceConfidence: response.SearchedFaceConfidence,
                matches: matches.map(match => ({
                    similarity: match.Similarity,
                    faceId: match.Face.FaceId,
                    externalImageId: match.Face.ExternalImageId,
                    confidence: match.Face.Confidence,
                    boundingBox: match.Face.BoundingBox
                }))
            };
        } catch (error) {
            if (error.name === 'InvalidParameterException') {
                logger.warn('Nenhuma face detectada na imagem de busca');
                return {
                    matchCount: 0,
                    matches: [],
                    error: 'Nenhuma face detectada na imagem'
                };
            }

            logger.error('Erro ao buscar faces:', error);
            throw new Error(`Erro na busca facial: ${error.message}`);
        }
    }

    /**
     * Delete indexed faces
     */
    async deleteFaces(faceIds) {
        try {
            if (!faceIds || faceIds.length === 0) {
                return { deletedFaces: [] };
            }

            const command = new DeleteFacesCommand({
                CollectionId: rekognition.collectionId,
                FaceIds: faceIds
            });

            const response = await rekognitionClient.send(command);

            logger.info(`Faces deletadas: ${response.DeletedFaces?.length || 0}`);

            return {
                deletedFaces: response.DeletedFaces || []
            };
        } catch (error) {
            logger.error('Erro ao deletar faces:', error);
            throw new Error(`Erro ao deletar faces: ${error.message}`);
        }
    }

    /**
     * Process photo: detect faces and index if found
     */
    async processPhoto(imageBuffer, photoId) {
        try {
            // First detect faces
            const detection = await this.detectFaces(imageBuffer);

            if (detection.faceCount === 0) {
                return {
                    faceCount: 0,
                    indexed: false,
                    faces: []
                };
            }

            // Index faces if detected
            const indexResult = await this.indexFaces(imageBuffer, photoId);

            return {
                faceCount: indexResult.faceCount,
                indexed: true,
                faces: indexResult.faces,
                unindexedFaces: indexResult.unindexedFaces
            };
        } catch (error) {
            logger.error('Erro ao processar foto:', error);
            throw error;
        }
    }
}

module.exports = new RekognitionService();
