import CORS from 'cors';
import Express from 'express';
import http from 'http';
import { nanoid } from 'nanoid';
import { AddressInfo } from 'net';
import { mock, mockReset } from 'jest-mock-extended';
import CoveyTownController from '../lib/CoveyTownController';
import CoveyTownsStore from '../lib/CoveyTownsStore';
import addTownRoutes from '../router/towns';
import * as requestHandlers from '../requestHandlers/CoveyTownRequestHandlers';
import { createConversationForTesting } from './TestUtils';
import TownsServiceClient, { ServerConversationArea, TownJoinResponse } from './TownsServiceClient';
import PlayerSession from '../types/PlayerSession';
import Player from '../types/Player';
import * as logger from '../Utils';

type TestTownData = {
  friendlyName: string;
  coveyTownID: string;
  isPubliclyListed: boolean;
  townUpdatePassword: string;
};

describe('Create Conversation Area API', () => {
  let server: http.Server;
  let apiClient: TownsServiceClient;
  let testingTown: TestTownData;
  let testingSession: TownJoinResponse;

  async function createTownForTesting(
    friendlyNameToUse?: string,
    isPublic = false,
  ): Promise<TestTownData> {
    const friendlyName =
      friendlyNameToUse !== undefined
        ? friendlyNameToUse
        : `${isPublic ? 'Public' : 'Private'}TestingTown=${nanoid()}`;
    const ret = await apiClient.createTown({
      friendlyName,
      isPubliclyListed: isPublic,
    });
    return {
      friendlyName,
      isPubliclyListed: isPublic,
      coveyTownID: ret.coveyTownID,
      townUpdatePassword: ret.coveyTownPassword,
    };
  }

  beforeAll(async () => {
    const app = Express();
    app.use(CORS());
    server = http.createServer(app);

    addTownRoutes(server, app);
    await server.listen();
    const address = server.address() as AddressInfo;

    apiClient = new TownsServiceClient(`http://127.0.0.1:${address.port}`);

    testingTown = await createTownForTesting(undefined, true);
    testingSession = await apiClient.joinTown({
      userName: nanoid(),
      coveyTownID: testingTown.coveyTownID,
    });
  });
  afterAll(async () => {
    await server.close();
  });
  it('Executes without error when creating a new conversation', async () => {
    await apiClient.createConversationArea({
      conversationArea: createConversationForTesting(),
      coveyTownID: testingTown.coveyTownID,
      sessionToken: testingSession.coveySessionToken,
    });
  });

  // student added tests
  it('should properly log errors when new conversation is not created', async () => {
    const loggerSpy = jest.spyOn(logger, 'logError').mockImplementationOnce(() => {});
    const someErrorMessage = new Error(nanoid());
    jest.spyOn(requestHandlers, 'conversationAreaCreateHandler').mockImplementationOnce(
      () => {throw someErrorMessage;},
    );
    await expect(apiClient.createConversationArea({
      conversationArea: createConversationForTesting(),
      coveyTownID: testingTown.coveyTownID,
      sessionToken: testingSession.coveySessionToken,
    })).rejects.toThrow('Request failed with status code 500');

    expect(loggerSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(someErrorMessage);
  });
});
describe('conversationAreaCreateHandler', () => {
  let coveyTownID: string;
  let conversationArea: ServerConversationArea;
  let mockSession: PlayerSession;

  const mockCoveyTownStore = mock<CoveyTownsStore>();
  const mockCoveyTownController = mock<CoveyTownController>();
  beforeAll(() => {
    // Set up a spy for CoveyTownsStore that will always return our mockCoveyTownsStore as the singleton instance
    jest.spyOn(CoveyTownsStore, 'getInstance').mockReturnValue(mockCoveyTownStore);
    coveyTownID = nanoid();
    conversationArea = { boundingBox: { height: 1, width: 1, x:1, y:1 }, label: nanoid(), occupantsByID: [], topic: nanoid() };
    mockSession = new PlayerSession(new Player(nanoid()));
  });
  beforeEach(() => {
    // Reset all mock calls, and ensure that getControllerForTown will always return the same mock controller
    mockReset(mockCoveyTownController);
    mockReset(mockCoveyTownStore);
    mockCoveyTownStore.getControllerForTown.mockReturnValue(mockCoveyTownController);
  });
  it('Checks for a valid session token before creating a conversation area', ()=>{
    const invalidSessionToken = nanoid();

    // Make sure to return 'undefined' regardless of what session token is passed
    mockCoveyTownController.getSessionByToken.mockReturnValueOnce(undefined);

    const resp = requestHandlers.conversationAreaCreateHandler({
      conversationArea,
      coveyTownID,
      sessionToken: invalidSessionToken,
    });
    expect(mockCoveyTownController.getSessionByToken).toBeCalledWith(invalidSessionToken);
    expect(mockCoveyTownController.addConversationArea).not.toHaveBeenCalled();
    // STUDENT ADDED expects
    expect(resp.isOK).toBeFalsy();
    expect(resp.message).toStrictEqual(`Unable to create conversation area ${conversationArea.label} with topic ${conversationArea.topic}`);
  });

  // student added tests
  it('should return the proper response for an valid token', async () => {
    mockCoveyTownController.getSessionByToken.mockReturnValue(mockSession);

    // case where conversation area is created
    mockCoveyTownController.addConversationArea.mockReturnValueOnce(true);

    const resp = requestHandlers.conversationAreaCreateHandler({ conversationArea, coveyTownID, sessionToken: mockSession.sessionToken });

    expect(resp.isOK).toBeTruthy();
    expect(resp.message).toBeUndefined();

    // case where conversation area is not created
    mockCoveyTownController.addConversationArea.mockReturnValueOnce(false);
    const resp2 = requestHandlers.conversationAreaCreateHandler({ conversationArea, coveyTownID, sessionToken: mockSession.sessionToken });

    expect(resp2.isOK).toBeFalsy();
    expect(resp2.message).toStrictEqual(`Unable to create conversation area ${conversationArea.label} with topic ${conversationArea.topic}`);
  });
});
