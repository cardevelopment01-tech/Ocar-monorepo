import { IRouter, Router } from 'express'
import * as controller from './vehicles.controller'

const router: IRouter = Router()

router.get('/categories',            controller.getCategories)
router.get('/brands',                controller.getBrands)
router.get('/brands/:brandId/models', controller.getModels)

export default router
